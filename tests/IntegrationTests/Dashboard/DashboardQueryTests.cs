using System.Net.Http.Json;
using System.Text.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Dashboard;

// Spins up the real AppHost and drives Dashboard.Api's GraphQL endpoint over HTTP, proving
// the "items" query actually joins live Catalog and Inventory data rather than just checking
// that each service works in isolation.
public class DashboardQueryTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    [Fact]
    public async Task ItemsQuery_ComposesCatalogAndInventoryData()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));

        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>();
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("dashboard-api", cts.Token);

        var catalog = app.CreateCatalogGrpcClient();
        var inventory = app.CreateHttpClient("inventory-api");
        var dashboard = app.CreateHttpClient("dashboard-api");

        var stockedSku = $"DASHBOARD-TEST-STOCKED-{Guid.NewGuid():N}";
        var unstockedSku = $"DASHBOARD-TEST-UNSTOCKED-{Guid.NewGuid():N}";

        await catalog.CreateItemAsync(new CreateItemRequest
        {
            Sku = stockedSku,
            Name = "Stocked Dashboard Item",
            Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString(),
            Price = "0"
        }, cancellationToken: cts.Token);
        await inventory.PostAsJsonAsync("/stock", new { Sku = stockedSku, InitialQuantity = 15 }, cts.Token);

        await catalog.CreateItemAsync(new CreateItemRequest
        {
            Sku = unstockedSku,
            Name = "Unstocked Dashboard Item",
            Barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString(),
            Price = "0"
        }, cancellationToken: cts.Token);

        var queryResponse = await dashboard.PostAsJsonAsync(
            "/graphql",
            new { query = "{ items { sku name quantityOnHand } }" },
            cts.Token);
        queryResponse.EnsureSuccessStatusCode();

        var payload = await queryResponse.Content.ReadFromJsonAsync<GraphQlResponse>(JsonOptions, cts.Token);
        var items = payload!.Data.Items;

        var stockedItem = Assert.Single(items, i => i.Sku == stockedSku);
        Assert.Equal(15, stockedItem.QuantityOnHand);

        var unstockedItem = Assert.Single(items, i => i.Sku == unstockedSku);
        Assert.Null(unstockedItem.QuantityOnHand);
    }

    private record GraphQlResponse(GraphQlData Data);
    private record GraphQlData(List<DashboardItem> Items);
    private record DashboardItem(string Sku, string Name, int? QuantityOnHand);
}
