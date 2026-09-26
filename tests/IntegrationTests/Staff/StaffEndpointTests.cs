using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Staff;

// Account creation is the one place a person types a credential that becomes real access, so the
// rules live at the HTTP boundary (AuthService itself accepts anything — the dev seed goes
// straight to it). One test drives them all so the AppHost boots once.
public class StaffEndpointTests
{
    [Fact]
    public async Task StaffAccounts_AreValidatedAudited_AndAdminOnly()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);

        var adminToken = await app.LoginAsAdminAsync(cts.Token);
        using var admin = app.CreateHttpClient("staff-api");
        admin.UseBearerToken(adminToken);

        Task<HttpResponseMessage> Create(string username, string password, string role = "Seller") =>
            admin.PostAsJsonAsync("/staff", new { Username = username, Password = password, Role = role }, cts.Token);

        // ---- rejected: each of these would otherwise have created a real, loginable account ----
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("", "GoodPassw0rd")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("ab", "GoodPassw0rd")).StatusCode);            // too short
        Assert.Equal(HttpStatusCode.BadRequest, (await Create(new string('a', 51), "GoodPassw0rd")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("has space", "GoodPassw0rd")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("semi;colon", "GoodPassw0rd")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("valid-user", "short")).StatusCode);            // password too short
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("valid-user", new string('p', 129))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("valid-user", "GoodPassw0rd", "Root")).StatusCode); // unknown role

        // ---- created ----
        var username = $"seller-{Guid.NewGuid():N}"[..20];
        var created = await Create(username, "GoodPassw0rd");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadAsStringAsync(cts.Token);
        Assert.Contains(username, body);
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase); // never echo a credential or its hash

        // ---- duplicates, including ones that differ only by case ----
        Assert.Equal(HttpStatusCode.Conflict, (await Create(username, "GoodPassw0rd")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Create(username.ToUpperInvariant(), "GoodPassw0rd")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Create("ADMIN", "GoodPassw0rd")).StatusCode); // can't shadow the seeded admin

        // ---- the new account can sign in, as a Seller ----
        var login = await admin.PostAsJsonAsync("/auth/login", new { Username = username, Password = "GoodPassw0rd" }, cts.Token);
        login.EnsureSuccessStatusCode();
        var session = (await login.Content.ReadFromJsonAsync<LoginResponse>(cts.Token))!;
        Assert.Equal("Seller", session.Role);

        // ---- it shows up, and the creation was audited ----
        var staff = (await admin.GetFromJsonAsync<List<StaffUser>>("/staff", cts.Token))!;
        Assert.Contains(staff, u => u.Username == username && u.Role == "Seller");

        var audit = (await admin.GetFromJsonAsync<List<AuditEntry>>("/audit-log", cts.Token))!;
        var entry = Assert.Single(audit, e => e.Username == username && e.Action == "UserCreated");
        Assert.Equal("Role=Seller", entry.Details);

        // ---- and a Seller can do none of it ----
        using var seller = app.CreateHttpClient("staff-api");
        seller.UseBearerToken(session.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await seller.GetAsync("/staff", cts.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await seller.GetAsync("/audit-log", cts.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await seller.PostAsJsonAsync("/staff", new { Username = "sneaky-admin", Password = "GoodPassw0rd", Role = "Admin" }, cts.Token)).StatusCode);
    }

    private record LoginResponse(string AccessToken, string Role);
    private record StaffUser(Guid Id, string Username, string Role);
    private record AuditEntry(Guid Id, string Username, string Action, string? Details);
}
