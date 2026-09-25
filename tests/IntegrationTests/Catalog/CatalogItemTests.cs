using Aspire.Hosting;
using Aspire.Hosting.Testing;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Catalog;

// Same approach as the Inventory concurrency test: spin up the real AppHost (real Postgres,
// real Catalog.Api process) and hit it over gRPC — the only surface Catalog.Api exposes now
// that its REST routes (all duplicates of this same gRPC contract) were removed.
public class CatalogItemTests
{
    private static async Task<(DistributedApplication App, CatalogGrpcService.CatalogGrpcServiceClient Catalog, Metadata Auth)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("catalog-api", token);

        // Step 9: every RPC now requires a valid JWT — log in once as the seeded dev admin.
        var authHeaders = AuthTestHelper.BearerHeaders(await app.LoginAsAdminAsync(token));

        return (app, app.CreateCatalogGrpcClient(), authHeaders);
    }

    [Fact]
    public async Task CreateItem_ThenLookupByBarcode_ReturnsTheSameItem()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        // Postgres persists across runs via WithDataVolume (intentional, for local dev), so
        // tests share that same data across runs too — unique values per run keep tests
        // independent of whatever leftover rows a previous run (or manual testing) left behind.
        var sku = $"CATALOG-TEST-BARCODE-LOOKUP-{Guid.NewGuid():N}";
        var barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString();

        await catalog.CreateItemAsync(
            new CreateItemRequest { Name = "Test Item", Sku = sku, Barcode = barcode, Price = "0" },
            headers: auth, cancellationToken: cts.Token);

        var found = await catalog.GetItemByBarcodeAsync(
            new GetItemByBarcodeRequest { Barcode = barcode }, headers: auth, cancellationToken: cts.Token);

        Assert.Equal(sku, found.Sku);
        Assert.Equal(barcode, found.Barcode);
    }

    [Fact]
    public async Task CreateItem_WithDuplicateSku_ReturnsAlreadyExists()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = $"CATALOG-TEST-DUPLICATE-SKU-{Guid.NewGuid():N}";

        await catalog.CreateItemAsync(
            new CreateItemRequest { Name = "First", Sku = sku, Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString(), Price = "0" },
            headers: auth, cancellationToken: cts.Token);

        var ex = await Assert.ThrowsAsync<RpcException>(() => catalog.CreateItemAsync(
            new CreateItemRequest { Name = "Second", Sku = sku, Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString(), Price = "0" },
            headers: auth, cancellationToken: cts.Token).ResponseAsync);

        Assert.Equal(StatusCode.AlreadyExists, ex.StatusCode);
    }

    [Fact]
    public async Task LookupByBarcode_ForUnknownBarcode_ReturnsNotFound()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var ex = await Assert.ThrowsAsync<RpcException>(() => catalog.GetItemByBarcodeAsync(
            new GetItemByBarcodeRequest { Barcode = "000000000000" },
            headers: auth, cancellationToken: cts.Token).ResponseAsync);

        Assert.Equal(StatusCode.NotFound, ex.StatusCode);
    }
}
