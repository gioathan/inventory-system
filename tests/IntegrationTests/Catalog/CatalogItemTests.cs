using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;

namespace InventorySystem.IntegrationTests.Catalog;

// Same approach as the Inventory concurrency test: spin up the real AppHost (real Postgres,
// real Catalog.Api process) and hit it over HTTP, rather than mocking anything.
public class CatalogItemTests
{
    private static async Task<(DistributedApplication App, HttpClient Client)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>();
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("catalog-api", token);

        return (app, app.CreateHttpClient("catalog-api"));
    }

    [Fact]
    public async Task CreateItem_ThenLookupByBarcode_ReturnsTheSameItem()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var (app, client) = await StartAsync(cts.Token);
        await using var _ = app;

        // Postgres persists across runs via WithDataVolume (intentional, for local dev), so
        // tests share that same data across runs too — unique values per run keep tests
        // independent of whatever leftover rows a previous run (or manual testing) left behind.
        var sku = $"CATALOG-TEST-BARCODE-LOOKUP-{Guid.NewGuid():N}";
        var barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString();

        var createResponse = await client.PostAsJsonAsync(
            "/items",
            new { Sku = sku, Name = "Test Item", Barcode = barcode },
            cts.Token);
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var found = await client.GetFromJsonAsync<ItemResponse>($"/items/by-barcode/{barcode}", cts.Token);

        Assert.NotNull(found);
        Assert.Equal(sku, found!.Sku);
        Assert.Equal(barcode, found.Barcode);
    }

    [Fact]
    public async Task CreateItem_WithDuplicateSku_ReturnsConflict()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var (app, client) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = $"CATALOG-TEST-DUPLICATE-SKU-{Guid.NewGuid():N}";

        var first = await client.PostAsJsonAsync(
            "/items",
            new { Sku = sku, Name = "First", Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString() },
            cts.Token);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var duplicate = await client.PostAsJsonAsync(
            "/items",
            new { Sku = sku, Name = "Second", Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString() },
            cts.Token);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task LookupByBarcode_ForUnknownBarcode_ReturnsNotFound()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var (app, client) = await StartAsync(cts.Token);
        await using var _ = app;

        var response = await client.GetAsync("/items/by-barcode/000000000000", cts.Token);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private record ItemResponse(string Sku, string Name, string Barcode, Guid? CategoryId);
}
