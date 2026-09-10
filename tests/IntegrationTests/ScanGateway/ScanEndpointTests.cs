using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;

namespace InventorySystem.IntegrationTests.ScanGateway;

// Spins up the real AppHost — all three services plus Postgres — and drives the scan flow
// entirely over HTTP, proving Scan Gateway's service-discovery calls to Catalog and Inventory
// actually resolve and compose correctly, not just that each service works in isolation.
public class ScanEndpointTests
{
    private static async Task<(DistributedApplication App, HttpClient Catalog, HttpClient Inventory, HttpClient ScanGateway)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>();
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("scan-gateway", token);

        return (app, app.CreateHttpClient("catalog-api"), app.CreateHttpClient("inventory-api"), app.CreateHttpClient("scan-gateway"));
    }

    [Fact]
    public async Task Scan_WhenItemAndStockBothExist_ReturnsComposedResult()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var (app, catalog, inventory, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = $"SCAN-TEST-{Guid.NewGuid():N}";
        var barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString();

        await catalog.PostAsJsonAsync("/items", new { Sku = sku, Name = "Scan Test Item", Barcode = barcode }, cts.Token);
        await inventory.PostAsJsonAsync("/stock", new { Sku = sku, InitialQuantity = 7 }, cts.Token);

        var result = await scanGateway.GetFromJsonAsync<ScanResponse>($"/scan/{barcode}", cts.Token);

        Assert.NotNull(result);
        Assert.Equal(sku, result!.Sku);
        Assert.Equal(7, result.QuantityOnHand);
    }

    [Fact]
    public async Task Scan_WhenItemExistsButHasNoStockRecord_ReturnsNullQuantity()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var (app, catalog, _, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = $"SCAN-TEST-NOSTOCK-{Guid.NewGuid():N}";
        var barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString();

        await catalog.PostAsJsonAsync("/items", new { Sku = sku, Name = "Unstocked Item", Barcode = barcode }, cts.Token);

        var result = await scanGateway.GetFromJsonAsync<ScanResponse>($"/scan/{barcode}", cts.Token);

        Assert.NotNull(result);
        Assert.Equal(sku, result!.Sku);
        Assert.Null(result.QuantityOnHand);
    }

    [Fact]
    public async Task Scan_WhenBarcodeIsUnknown_ReturnsNotFound()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var (app, _, _, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var response = await scanGateway.GetAsync("/scan/000000000000", cts.Token);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private record ScanResponse(string Sku, string Name, string Barcode, int? QuantityOnHand);
}
