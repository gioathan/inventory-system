using System.Net.Http.Json;
using System.Text.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Dashboard;

// A session's report must value each sale at the price actually paid — so a discount that starts
// halfway through a session changes only the sales made after it — and must know each item's
// stock when the period began and ended. Also checks the counts-only read sellers get.
public class SessionReportTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    [Fact]
    public async Task SessionReport_UsesThePricePaidAtEachSale_AndKnowsOpeningAndClosingStock()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(150));

        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("scan-gateway", cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("dashboard-api", cts.Token);

        var jwt = await app.LoginAsAdminAsync(cts.Token);
        var gateway = app.CreateHttpClient("scan-gateway");
        var dashboard = app.CreateHttpClient("dashboard-api");
        gateway.UseBearerToken(jwt);
        dashboard.UseBearerToken(jwt);

        // Stocked before the session starts, so its opening stock is 10, not 0.
        var intake = await gateway.PostAsJsonAsync("/items/intake",
            new { Name = $"Report Test Item {Guid.NewGuid():N}", Price = 10m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 10 }, cts.Token);
        intake.EnsureSuccessStatusCode();
        var item = (await intake.Content.ReadFromJsonAsync<Intake>(cts.Token))!;

        var started = await gateway.PostAsJsonAsync("/restock-sessions", new { Note = "report test" }, cts.Token);
        var sessionId = (await started.Content.ReadFromJsonAsync<OpenResponse>(cts.Token))!.Opened.Id;

        (await gateway.PostAsJsonAsync($"/scan/{item.Barcode}/receive", new { Quantity = 5 }, cts.Token)).EnsureSuccessStatusCode();
        (await gateway.PostAsJsonAsync($"/scan/{item.Barcode}/sell", new { Quantity = 2 }, cts.Token)).EnsureSuccessStatusCode(); // 2 × 10
        (await gateway.PostAsJsonAsync("/items/discount", new { Skus = new[] { item.Sku }, Percentage = 0.5 }, cts.Token)).EnsureSuccessStatusCode();
        (await gateway.PostAsJsonAsync($"/scan/{item.Barcode}/sell", new { Quantity = 1 }, cts.Token)).EnsureSuccessStatusCode(); // 1 × 5

        var counts = await gateway.GetFromJsonAsync<Counts>("/restock-sessions/current/sales", cts.Token);
        var countLine = counts!.Lines.Single(l => l.Sku == item.Sku);
        Assert.Equal(sessionId, counts.Session!.Id);
        Assert.Equal((3, 5), (countLine.Sold, countLine.Restocked));

        var response = await dashboard.PostAsJsonAsync("/graphql", new
        {
            query = $"{{ sessionReport(sessionId: \"{sessionId}\") {{ sku restocked sold openingQuantity closingQuantity revenue revenueEstimated }} }}"
        }, cts.Token);
        response.EnsureSuccessStatusCode();
        var body = JsonSerializer.Deserialize<GraphQlResponse>(await response.Content.ReadAsStringAsync(cts.Token), JsonOptions)!;
        var line = body.Data!.SessionReport.Single(l => l.Sku == item.Sku);

        Assert.Equal(5, line.Restocked);
        Assert.Equal(3, line.Sold);
        Assert.Equal(10, line.OpeningQuantity);
        Assert.Equal(12, line.ClosingQuantity); // 10 + 5 − 3
        Assert.Equal(25m, line.Revenue); // 2 × 10 + 1 × 5 — not 3 × today's 5
        Assert.False(line.RevenueEstimated);

        // Leave no test session open, and no stray promo, on the shared dev stack.
        (await gateway.PostAsync($"/restock-sessions/{sessionId}/close", null, cts.Token)).EnsureSuccessStatusCode();
        (await gateway.PostAsJsonAsync("/items/discount/remove", new { Skus = new[] { item.Sku } }, cts.Token)).EnsureSuccessStatusCode();
    }

    private record Intake(string Sku, string Barcode);
    private record Session(Guid Id);
    private record OpenResponse(Session Opened);
    private record CountLine(string Sku, int Sold, int Restocked);
    private record Counts(Session? Session, List<CountLine> Lines);
    private record ReportLine(string Sku, int Restocked, int Sold, int OpeningQuantity, int ClosingQuantity, decimal? Revenue, bool RevenueEstimated);
    private record ReportData(List<ReportLine> SessionReport);
    private record GraphQlResponse(ReportData? Data);
}
