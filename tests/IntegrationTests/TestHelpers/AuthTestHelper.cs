using System.Net.Http.Headers;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using global::Grpc.Core;

namespace InventorySystem.IntegrationTests.TestHelpers;

// Every endpoint in the system now requires a valid JWT (step 9) — this is the one place that
// knows how to get one, using the same seeded dev admin account Staff.Api creates on first
// startup (see Staff.Api/Program.cs). Tests always log in as Admin: it's a superset of Seller,
// so it can exercise every endpoint regardless of which role a given route actually requires.
public static class AuthTestHelper
{
    private const string SeedUsername = "admin";
    private const string SeedPassword = "ChangeMe123!";

    public static async Task<string> LoginAsAdminAsync(this DistributedApplication app, CancellationToken cancellationToken)
    {
        await app.ResourceNotifications.WaitForResourceHealthyAsync("staff-api", cancellationToken);

        using var staffClient = app.CreateHttpClient("staff-api");
        var response = await staffClient.PostAsJsonAsync(
            "/auth/login",
            new { Username = SeedUsername, Password = SeedPassword },
            cancellationToken);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<LoginResponse>(cancellationToken: cancellationToken);
        return result!.AccessToken;
    }

    public static void UseBearerToken(this HttpClient client, string token) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

    public static Metadata BearerHeaders(string token) => new() { { "Authorization", $"Bearer {token}" } };

    private record LoginResponse(string AccessToken, DateTimeOffset ExpiresAt, string Role);
}
