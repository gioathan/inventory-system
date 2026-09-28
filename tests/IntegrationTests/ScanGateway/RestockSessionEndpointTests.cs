using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.ScanGateway;

// Drives the restock-session routes over HTTP against the real AppHost: starting a session closes
// the open one at the same instant, "no session" is a normal 200, and closing twice is refused.
// Sessions are one system-wide timeline, so these tests don't assume what was open before them.
public class RestockSessionEndpointTests
{
    private static async Task<(DistributedApplication App, HttpClient ScanGateway)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("scan-gateway", token);

        var scanGateway = app.CreateHttpClient("scan-gateway");
        scanGateway.UseBearerToken(await app.LoginAsAdminAsync(token));
        return (app, scanGateway);
    }

    [Fact]
    public async Task StartingASession_ClosesTheOpenOne_AndClosingTwiceIsRefused()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var firstResponse = await scanGateway.PostAsJsonAsync("/restock-sessions", new { Note = $"first {Guid.NewGuid():N}" }, cts.Token);
        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        var first = (await firstResponse.Content.ReadFromJsonAsync<OpenResponse>(cts.Token))!.Opened;

        var current = await scanGateway.GetFromJsonAsync<CurrentResponse>("/restock-sessions/current", cts.Token);
        Assert.Equal(first.Id, current!.Session!.Id);

        var secondResponse = await scanGateway.PostAsJsonAsync("/restock-sessions", new { Note = (string?)null }, cts.Token);
        var second = (await secondResponse.Content.ReadFromJsonAsync<OpenResponse>(cts.Token))!;
        Assert.Equal(first.Id, second.Closed!.Id);
        Assert.Equal(second.Opened.OpenedAt, second.Closed.ClosedAt); // one instant: the periods never overlap or leave a gap

        var list = await scanGateway.GetFromJsonAsync<List<Session>>("/restock-sessions", cts.Token);
        Assert.Single(list!, s => s.ClosedAt is null);
        Assert.Equal(second.Opened.Id, list![0].Id); // newest first

        var closed = await scanGateway.PostAsync($"/restock-sessions/{second.Opened.Id}/close", null, cts.Token);
        Assert.Equal(HttpStatusCode.OK, closed.StatusCode);

        var none = await scanGateway.GetFromJsonAsync<CurrentResponse>("/restock-sessions/current", cts.Token);
        Assert.Null(none!.Session);

        var again = await scanGateway.PostAsync($"/restock-sessions/{second.Opened.Id}/close", null, cts.Token);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task ClosingAnUnknownSession_ReturnsNotFound()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var response = await scanGateway.PostAsync($"/restock-sessions/{Guid.NewGuid()}/close", null, cts.Token);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private record Session(Guid Id, DateTimeOffset OpenedAt, DateTimeOffset? ClosedAt, string? Note);
    private record OpenResponse(Session Opened, Session? Closed);
    private record CurrentResponse(Session? Session);
}
