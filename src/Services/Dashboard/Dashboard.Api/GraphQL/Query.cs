using HotChocolate.Authorization;
using InventorySystem.Auth.Contracts;
using InventorySystem.Dashboard.Api.Clients;

namespace InventorySystem.Dashboard.Api.GraphQL;

public class Query
{
    // The one thing this whole service exists for: fan out to Catalog and Inventory in
    // parallel, then join their results in memory by Sku — the "aggregate multiple services
    // into one client-shaped query" problem that's the entire justification for GraphQL here.
    [Authorize(Policy = AuthPolicies.SellerOrAdmin)]
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

    // Answers "how much did I sell / restock between two points in time, and what's that worth."
    // Inventory only knows quantities (its ledger has no concept of price); this resolver is
    // the join point that turns "sold 4" into "sold 4, that's $X" using Catalog's price.
    // Admin-only: this is revenue data, not a day-to-day seller action.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IEnumerable<SessionReportLine>> SessionReport(
        Guid sessionId,
        [Service] CatalogApiClient catalog,
        [Service] InventoryApiClient inventory,
        CancellationToken cancellationToken)
    {
        var summaryTask = inventory.GetSessionSummaryAsync(sessionId, cancellationToken);
        var itemsTask = catalog.GetAllItemsAsync(cancellationToken);
        await Task.WhenAll(summaryTask, itemsTask);

        var itemsBySku = itemsTask.Result.ToDictionary(i => i.Sku);

        return summaryTask.Result.Select(line =>
        {
            itemsBySku.TryGetValue(line.Sku, out var item);
            var price = item?.Price;

            return new SessionReportLine(
                line.Sku,
                item?.Name,
                line.Restocked,
                line.Sold,
                line.NetDelta,
                price is null ? null : price * line.Sold);
        });
    }
}

public record DashboardItem(string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId, int? QuantityOnHand);
public record SessionReportLine(string Sku, string? Name, int Restocked, int Sold, int NetDelta, decimal? Revenue);
