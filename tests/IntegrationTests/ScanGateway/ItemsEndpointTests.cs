using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.ScanGateway;

// Drives PUT /items/{sku} over HTTP against the real AppHost — proves the full-replace edit
// actually persists, that changing the barcode moves the item's scan lookup to the new value
// (and drops the old one, per the cache-invalidation reasoning in CatalogApiClient), and that
// the same validation/conflict rules CreateItem enforces apply here too.
public class ItemsEndpointTests
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

    private static async Task<ReceiveResponse> IntakeAsync(HttpClient scanGateway, string name, decimal price, CancellationToken token)
    {
        var response = await scanGateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = name, Price = price, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 1 },
            token);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ReceiveResponse>(token))!;
    }

    [Fact]
    public async Task UpdateItem_ChangesTheItemAndMovesItsScanLookupToTheNewBarcode()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var original = await IntakeAsync(scanGateway, $"Edit Test Item {Guid.NewGuid():N}", 20m, cts.Token);
        var newBarcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString();

        // Scan once under the old barcode first, so its cache entry exists to prove gets invalidated.
        (await scanGateway.GetAsync($"/scan/{original.Barcode}", cts.Token)).EnsureSuccessStatusCode();

        var response = await scanGateway.PutAsJsonAsync(
            $"/items/{original.Sku}",
            new { Name = "Edited Name", Price = 30m, Barcode = newBarcode, CategoryId = (Guid?)null, ImageUrl = (string?)null },
            cts.Token);
        response.EnsureSuccessStatusCode();

        var updated = await response.Content.ReadFromJsonAsync<CatalogItem>(cts.Token);
        Assert.Equal(original.Sku, updated!.Sku);
        Assert.Equal("Edited Name", updated.Name);
        Assert.Equal(30m, updated.Price);
        Assert.Equal(newBarcode, updated.Barcode);

        var byNewBarcode = await scanGateway.GetFromJsonAsync<ReceiveResponse>($"/scan/{newBarcode}", cts.Token);
        Assert.Equal(original.Sku, byNewBarcode!.Sku);
        Assert.Equal("Edited Name", byNewBarcode.Name);

        var byOldBarcode = await scanGateway.GetAsync($"/scan/{original.Barcode}", cts.Token);
        Assert.Equal(HttpStatusCode.NotFound, byOldBarcode.StatusCode);
    }

    [Fact]
    public async Task UpdateItem_ForUnknownSku_ReturnsNotFound()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var response = await scanGateway.PutAsJsonAsync(
            "/items/NO-SUCH-SKU",
            new { Name = "X", Price = 1m, Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString(), CategoryId = (Guid?)null, ImageUrl = (string?)null },
            cts.Token);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateItem_WithAnotherItemsBarcode_ReturnsConflict()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var holder = await IntakeAsync(scanGateway, $"Barcode Holder {Guid.NewGuid():N}", 1m, cts.Token);
        var wanter = await IntakeAsync(scanGateway, $"Barcode Wanter {Guid.NewGuid():N}", 1m, cts.Token);

        var response = await scanGateway.PutAsJsonAsync(
            $"/items/{wanter.Sku}",
            new { Name = wanter.Name, Price = 1m, Barcode = holder.Barcode, CategoryId = (Guid?)null, ImageUrl = (string?)null },
            cts.Token);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Theory]
    [InlineData("", 10, "has space")] // blank name
    [InlineData("Valid Name", 0, "1234567890")] // non-positive price
    [InlineData("Valid Name", 10, "has space")] // unsafe barcode characters
    public async Task UpdateItem_WithInvalidInput_ReturnsBadRequest(string name, decimal price, string barcode)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var item = await IntakeAsync(scanGateway, $"Validation Test Item {Guid.NewGuid():N}", 5m, cts.Token);

        var response = await scanGateway.PutAsJsonAsync(
            $"/items/{item.Sku}",
            new { Name = name, Price = price, Barcode = barcode, CategoryId = (Guid?)null, ImageUrl = (string?)null },
            cts.Token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private record ReceiveResponse(string Sku, string Name, string Barcode, decimal Price, int QuantityOnHand);
    private record CatalogItem(string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId, double? DiscountPercentage, decimal EffectivePrice);
}
