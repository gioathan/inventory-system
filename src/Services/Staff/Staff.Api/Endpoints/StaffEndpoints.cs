using System.Text.RegularExpressions;
using InventorySystem.Auth.Contracts;
using InventorySystem.Staff.Api.Data;
using InventorySystem.Staff.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Staff.Api.Endpoints;

public static partial class StaffEndpoints
{
    [GeneratedRegex("^[A-Za-z0-9._-]{3,50}$")]
    private static partial Regex ValidUsername { get; }

    private const int MinPasswordLength = 8;
    private const int MaxPasswordLength = 128;

    public static void MapStaffEndpoints(this WebApplication app)
    {
        // Admin-only: creating a staff account isn't something a Seller (or an unauthenticated
        // caller) should ever be able to do. The very first admin is seeded on startup (see
        // Program.cs) since nothing can create it otherwise.
        app.MapPost("/staff", async (CreateStaffUserRequest request, AuthService auth, CancellationToken cancellationToken) =>
        {
            // Checked at the HTTP boundary: AuthService itself accepts anything (the dev seed goes
            // straight to it), so without this a blank username or a one-character password would
            // create a real, loginable account.
            if (request.Username is null || !ValidUsername.IsMatch(request.Username))
                return Results.BadRequest("Username must be 3 to 50 characters: letters, digits, '.', '_' or '-'.");
            if (request.Password is null || request.Password.Length < MinPasswordLength || request.Password.Length > MaxPasswordLength)
                return Results.BadRequest($"Password must be {MinPasswordLength} to {MaxPasswordLength} characters.");

            try
            {
                var user = await auth.CreateUserAsync(request.Username, request.Password, request.Role, cancellationToken);
                return Results.Created($"/staff/{user.Id}", ToResponse(user));
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly);

        app.MapGet("/staff", async (StaffDbContext db, CancellationToken cancellationToken) =>
        {
            var users = await db.StaffUsers.AsNoTracking()
                .Select(u => new StaffUserResponse(u.Id, u.Username, u.Role, u.CreatedAt))
                .ToListAsync(cancellationToken);
            return Results.Ok(users);
        }).RequireAuthorization(AuthPolicies.AdminOnly);
    }

    private static StaffUserResponse ToResponse(StaffUser user) =>
        new(user.Id, user.Username, user.Role, user.CreatedAt);
}

public record CreateStaffUserRequest(string Username, string Password, string Role);
public record StaffUserResponse(Guid Id, string Username, string Role, DateTimeOffset CreatedAt);
