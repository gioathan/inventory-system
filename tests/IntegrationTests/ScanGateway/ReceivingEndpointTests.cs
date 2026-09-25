using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.ScanGateway;

// Spins up the real AppHost and drives the intake/restock flows over HTTP, proving the
// "new item, no barcode known yet" and "I scanned something the system already knows about"
// paths actually compose Catalog's auto-generated code with Inventory's atomic upsert-add.
public class ReceivingEndpointTests
{
    private static async Task<(DistributedApplication App, HttpClient ScanGateway)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("scan-gateway", token);

        // Step 9: every endpoint now requires a valid JWT.
        var scanGateway = app.CreateHttpClient("scan-gateway");
        scanGateway.UseBearerToken(await app.LoginAsAdminAsync(token));

        return (app, scanGateway);
    }

    [Fact]
    public async Task Intake_CreatesNewItemWithGeneratedBarcodeAndInitialQuantity()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var name = $"Intake Test Item {Guid.NewGuid():N}";

        var response = await scanGateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = name, Price = 12.50m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 20 },
            cts.Token);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<ReceiveResponse>(cts.Token);

        Assert.NotNull(result);
        Assert.False(string.IsNullOrWhiteSpace(result!.Barcode));
        Assert.Equal(name, result.Name);
        Assert.Equal(12.50m, result.Price);
        Assert.Equal(20, result.QuantityOnHand);

        // The generated barcode must actually resolve through the normal scan lookup.
        var scanned = await scanGateway.GetFromJsonAsync<ReceiveResponse>($"/scan/{result.Barcode}", cts.Token);
        Assert.Equal(result.Sku, scanned!.Sku);
    }

    [Fact]
    public async Task Intake_ThenRestock_AddsToExistingQuantity()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var intakeResponse = await scanGateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = $"Restock Test Item {Guid.NewGuid():N}", Price = 5.00m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 10 },
            cts.Token);
        var created = await intakeResponse.Content.ReadFromJsonAsync<ReceiveResponse>(cts.Token);

        var restockResponse = await scanGateway.PostAsJsonAsync(
            $"/scan/{created!.Barcode}/receive",
            new { Quantity = 7 },
            cts.Token);
        restockResponse.EnsureSuccessStatusCode();

        var restocked = await restockResponse.Content.ReadFromJsonAsync<ReceiveResponse>(cts.Token);

        Assert.Equal(17, restocked!.QuantityOnHand);
    }

    [Fact]
    public async Task Restock_ForUnknownBarcode_ReturnsNotFound()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var response = await scanGateway.PostAsJsonAsync(
            "/scan/000000000000/receive",
            new { Quantity = 5 },
            cts.Token);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Restock_WithNonPositiveQuantity_ReturnsBadRequest()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var intakeResponse = await scanGateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = $"Bad Quantity Test Item {Guid.NewGuid():N}", Price = 1.00m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 1 },
            cts.Token);
        var created = await intakeResponse.Content.ReadFromJsonAsync<ReceiveResponse>(cts.Token);

        var response = await scanGateway.PostAsJsonAsync(
            $"/scan/{created!.Barcode}/receive",
            new { Quantity = 0 },
            cts.Token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private record ReceiveResponse(string Sku, string Name, string Barcode, decimal Price, int QuantityOnHand);
}
