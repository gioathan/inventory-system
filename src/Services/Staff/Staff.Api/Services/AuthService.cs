using InventorySystem.Auth.Contracts;
using InventorySystem.Staff.Api.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace InventorySystem.Staff.Api.Services;

public record LoginResult(bool Succeeded, string? AccessToken, DateTimeOffset? ExpiresAt, string? Role, bool LockedOut = false)
{
    public static LoginResult Failed() => new(false, null, null, null);
    public static LoginResult Locked() => new(false, null, null, null, LockedOut: true);
    public static LoginResult Success(IssuedToken token, string role) => new(true, token.AccessToken, token.ExpiresAt, role);
}

public enum DeleteUserOutcome { Deleted, NotFound, IsSelf, LastAdmin, ActorNotAllowed }

public class AuthService(StaffDbContext db, IPasswordHasher<StaffUser> hasher, IConfiguration configuration)
{
    // Every attempt gets logged — success or failure, known or unknown username — so the audit
    // log actually answers "who tried to get in," not just "who succeeded."
    public async Task<LoginResult> LoginAsync(string username, string password, CancellationToken cancellationToken)
    {
        if (await IsLockedOutAsync(username, cancellationToken))
            return LoginResult.Locked();

        var user =await db.StaffUsers.FirstOrDefaultAsync(u => u.Username == username, cancellationToken);
        if (user is null)
        {
            await LogAsync(null, username, "LoginFailed", "Unknown username", cancellationToken);
            return LoginResult.Failed();
        }

        if (hasher.VerifyHashedPassword(user, user.PasswordHash, password) == PasswordVerificationResult.Failed)
        {
            await LogAsync(user.Id, username, "LoginFailed", "Bad password", cancellationToken);
            return LoginResult.Failed();
        }

        var signingKey = configuration[JwtConstants.SigningKeyConfigKey]
            ?? throw new InvalidOperationException($"Missing configuration value '{JwtConstants.SigningKeyConfigKey}'.");

        var token = JwtTokenFactory.CreateToken(user.Id, user.Username, user.Role, signingKey);
        await LogAsync(user.Id, username, "LoginSucceeded", null, cancellationToken);
        return LoginResult.Success(token, user.Role);
    }

    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutWindow = TimeSpan.FromMinutes(5);

    // Slows password guessing: after MaxFailedAttempts failures for one username inside the
    // window (counted from its last successful sign-in, so a typo or two never adds up across a
    // shift), further attempts are refused until the oldest failure ages out. Counted from the
    // audit log, which already records every attempt — and applied to unknown usernames too, so
    // being locked out says nothing about whether the account exists. Refused attempts aren't
    // logged themselves: they'd extend the lockout forever and let a guessing loop flood the log.
    private async Task<bool> IsLockedOutAsync(string username, CancellationToken cancellationToken)
    {
        var windowStart = DateTimeOffset.UtcNow - LockoutWindow;
        var lastSuccess = await db.AuditLogEntries
            .Where(e => e.Username == username && e.Action == "LoginSucceeded" && e.Timestamp >= windowStart)
            .MaxAsync(e => (DateTimeOffset?)e.Timestamp, cancellationToken);
        var since = lastSuccess ?? windowStart;

        var failures = await db.AuditLogEntries
            .CountAsync(e => e.Username == username && e.Action == "LoginFailed" && e.Timestamp > since, cancellationToken);
        return failures >= MaxFailedAttempts;
    }

    public async Task<StaffUser> CreateUserAsync(string username, string password, string role, CancellationToken cancellationToken)
    {
        if (role != StaffRoles.Admin && role != StaffRoles.Seller)
            throw new ArgumentException($"Unknown role '{role}'. Must be '{StaffRoles.Admin}' or '{StaffRoles.Seller}'.", nameof(role));

        // Case-insensitive on purpose: "Admin" and "admin" as two accounts would let one impersonate
        // the other in an audit trail. (Login still matches the exact spelling.)
        var lowered = username.ToLower();
        if (await db.StaffUsers.AnyAsync(u => u.Username.ToLower() == lowered, cancellationToken))
            throw new InvalidOperationException($"Username '{username}' already exists.");

        var user = new StaffUser
        {
            Id = Guid.NewGuid(),
            Username = username,
            Role = role,
            PasswordHash = "",
            CreatedAt = DateTimeOffset.UtcNow
        };
        user.PasswordHash = hasher.HashPassword(user, password);

        db.StaffUsers.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        await LogAsync(user.Id, username, "UserCreated", $"Role={role}", cancellationToken);
        return user;
    }

    // Removes the account for good. The audit log keeps its own copy of the username on every
    // entry, so past entries still read correctly afterwards.
    //
    // The acting admin is looked up rather than trusted from the token: tokens can't be revoked
    // (see JwtConstants), so an admin who was deleted an hour ago still holds a valid one, and
    // without this check could go on deleting the accounts that remain.
    public async Task<DeleteUserOutcome> DeleteUserAsync(Guid id, Guid actorId, CancellationToken cancellationToken)
    {
        var actor = await db.StaffUsers.AsNoTracking().FirstOrDefaultAsync(u => u.Id == actorId, cancellationToken);
        if (actor is null || actor.Role != StaffRoles.Admin)
            return DeleteUserOutcome.ActorNotAllowed;

        if (id == actorId)
            return DeleteUserOutcome.IsSelf;

        var user = await db.StaffUsers.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
            return DeleteUserOutcome.NotFound;

        // Can't normally be reached — the acting admin is a second one — but it's the rule that
        // matters most here (nobody left who can manage accounts), so it's stated outright.
        if (user.Role == StaffRoles.Admin && await db.StaffUsers.CountAsync(u => u.Role == StaffRoles.Admin, cancellationToken) <= 1)
            return DeleteUserOutcome.LastAdmin;

        db.StaffUsers.Remove(user);
        await db.SaveChangesAsync(cancellationToken);
        await LogAsync(user.Id, user.Username, "UserDeleted", $"Role={user.Role}; DeletedBy={actor.Username}", cancellationToken);
        return DeleteUserOutcome.Deleted;
    }

    private async Task LogAsync(Guid? userId, string username, string action, string? details, CancellationToken cancellationToken)
    {
        db.AuditLogEntries.Add(new AuditLogEntry
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Username = username,
            Action = action,
            Timestamp = DateTimeOffset.UtcNow,
            Details = details
        });
        await db.SaveChangesAsync(cancellationToken);
    }
}
