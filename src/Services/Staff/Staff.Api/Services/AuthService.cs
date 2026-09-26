using InventorySystem.Auth.Contracts;
using InventorySystem.Staff.Api.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace InventorySystem.Staff.Api.Services;

public record LoginResult(bool Succeeded, string? AccessToken, DateTimeOffset? ExpiresAt, string? Role)
{
    public static LoginResult Failed() => new(false, null, null, null);
    public static LoginResult Success(IssuedToken token, string role) => new(true, token.AccessToken, token.ExpiresAt, role);
}

public class AuthService(StaffDbContext db, IPasswordHasher<StaffUser> hasher, IConfiguration configuration)
{
    // Every attempt gets logged — success or failure, known or unknown username — so the audit
    // log actually answers "who tried to get in," not just "who succeeded."
    public async Task<LoginResult> LoginAsync(string username, string password, CancellationToken cancellationToken)
    {
        var user = await db.StaffUsers.FirstOrDefaultAsync(u => u.Username == username, cancellationToken);
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
