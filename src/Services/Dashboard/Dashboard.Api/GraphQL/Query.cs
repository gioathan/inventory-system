using InventorySystem.Dashboard.Api.Clients;

namespace InventorySystem.Dashboard.Api.GraphQL;

public class Query
{
    // The one thing this whole service exists for: fan out to Catalog and Inventory in
    // parallel, then join their results in memory by Sku — the "aggregate multiple services
    // into one client-shaped query" problem that's the entire justification for GraphQL here.
    public async Task<IEnumerable<DashboardItem>> GetItems(
        [Service] CatalogApiClient catalog,
        [Service] InventoryApiClient inventory,
        CancellationToken cancellationToken)
    {
        var itemsTask = catalog.GetAllItemsAsync(cancellationToken);
        var stockTask = inventory.GetAllStockAsync(cancellationToken);
        await Task.WhenAll(itemsTask, stockTask);

        var stockBySku = stockTask.Result.ToDictionary(s => s.Sku, s => s.QuantityOnHand);

        return itemsTask.Result.Select(item => new DashboardItem(
            item.Sku,
            item.Name,
            item.Barcode,
            item.Price,
            item.ImageUrl,
            item.CategoryId,
            stockBySku.TryGetValue(item.Sku, out var quantity) ? quantity : null));
    }
}

public record DashboardItem(string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId, int? QuantityOnHand);
