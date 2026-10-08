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
    public async Task Intake_WithSuppliedBarcode_RegistersUnderThatBarcodeAndRejectsDuplicates()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        // A goods-that-already-carry-a-UPC case: the caller's barcode is used verbatim.
        var manufacturerBarcode = $"MFR{Guid.NewGuid():N}"[..20];

        var first = await scanGateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = "Manufacturer Barcode Item", Price = 9.99m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 4, Barcode = manufacturerBarcode },
            cts.Token);
        first.EnsureSuccessStatusCode();
        var created = await first.Content.ReadFromJsonAsync<ReceiveResponse>(cts.Token);
        Assert.Equal(manufacturerBarcode, created!.Barcode);

        var scanned = await scanGateway.GetFromJsonAsync<ReceiveResponse>($"/scan/{manufacturerBarcode}", cts.Token);
        Assert.Equal(created.Sku, scanned!.Sku);
        Assert.Equal(4, scanned.QuantityOnHand);

        // Registering a second item under the same barcode is a real conflict, not a silent overwrite.
        var duplicate = await scanGateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = "Same Barcode Again", Price = 1.00m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 1, Barcode = manufacturerBarcode },
            cts.Token);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task Intake_WithBarcodeThatCouldBreakRouting_ReturnsBadRequest()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        // A loop rather than a [Theory]: each theory case would boot the whole AppHost again.
        foreach (var barcode in new[] { "has/slash", "has space", "query?x=1", new string('9', 65) })
        {
            var response = await scanGateway.PostAsJsonAsync(
                "/items/intake",
                new { Name = "Unsafe Barcode Item", Price = 1.00m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 1, Barcode = barcode },
                cts.Token);

            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"'{barcode}' should be rejected but got {response.StatusCode}");
        }
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

    [Fact]
    public async Task BatchReceive_AppliesGoodLinesAndReportsBadOnesWithoutBlockingTheRest()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        async Task<ReceiveResponse> IntakeAsync(int quantity)
        {
            var response = await scanGateway.PostAsJsonAsync(
                "/items/intake",
                new { Name = $"Batch Test Item {Guid.NewGuid():N}", Price = 2.00m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = quantity },
                cts.Token);
            return (await response.Content.ReadFromJsonAsync<ReceiveResponse>(cts.Token))!;
        }

        var a = await IntakeAsync(10);
        var b = await IntakeAsync(1);

        var response = await scanGateway.PostAsJsonAsync(
            "/receive/batch",
            new
            {
                Lines = new[]
                {
                    new { Sku = a.Sku, Quantity = 24 },
                    new { Sku = "NO-SUCH-SKU", Quantity = 5 },
                    new { Sku = b.Sku, Quantity = 0 },
                    new { Sku = b.Sku, Quantity = 6 },
                },
            },
            cts.Token);

        // 200 even though two lines were rejected: the outcome is per line, not per request.
        response.EnsureSuccessStatusCode();
        var results = (await response.Content.ReadFromJsonAsync<BatchReceiveResponse>(cts.Token))!.Results;

        Assert.Equal(4, results.Count);
        Assert.Equal(("received", 34), (results[0].Status, results[0].QuantityOnHand!.Value));
        Assert.Equal("notFound", results[1].Status);
        Assert.Equal("invalid", results[2].Status);
        Assert.Equal(("received", 7), (results[3].Status, results[3].QuantityOnHand!.Value));

        // The stock really moved for the good lines...
        Assert.Equal(34, (await scanGateway.GetFromJsonAsync<ReceiveResponse>($"/scan/{a.Barcode}", cts.Token))!.QuantityOnHand);
        Assert.Equal(7, (await scanGateway.GetFromJsonAsync<ReceiveResponse>($"/scan/{b.Barcode}", cts.Token))!.QuantityOnHand);
    }

    [Fact]
    public async Task BatchReceive_WithNoLinesOrTooMany_ReturnsBadRequest()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, scanGateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var empty = await scanGateway.PostAsJsonAsync("/receive/batch", new { Lines = Array.Empty<object>() }, cts.Token);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);

        var tooMany = await scanGateway.PostAsJsonAsync(
            "/receive/batch",
            new { Lines = Enumerable.Range(0, 501).Select(_ => new { Sku = "X", Quantity = 1 }) },
            cts.Token);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    private record ReceiveResponse(string Sku, string Name, string Barcode, decimal Price, int QuantityOnHand);
    private record BatchReceiveLineResult(string Sku, string Status, int? QuantityOnHand, string? Error);
    private record BatchReceiveResponse(List<BatchReceiveLineResult> Results);
}
