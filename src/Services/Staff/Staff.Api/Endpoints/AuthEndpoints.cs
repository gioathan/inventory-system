using InventorySystem.Staff.Api.Services;

namespace InventorySystem.Staff.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        // Deliberately no .RequireAuthorization() — this is the one endpoint in the whole
        // system that must stay reachable without a token, since it's how you get one.
        app.MapPost("/auth/login", async (LoginRequest request, AuthService auth, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password))
                return Results.BadRequest("Username and password are required.");

            var result = await auth.LoginAsync(request.Username, request.Password, cancellationToken);
            if (result.LockedOut)
                return Results.Problem("Too many failed sign-in attempts. Try again in a few minutes.", statusCode: StatusCodes.Status429TooManyRequests);

            return result.Succeeded
                ? Results.Ok(new LoginResponse(result.AccessToken!, result.ExpiresAt!.Value, result.Role!))
                : Results.Unauthorized();
        });
    }
}

public record LoginRequest(string Username, string Password);
public record LoginResponse(string AccessToken, DateTimeOffset ExpiresAt, string Role);
