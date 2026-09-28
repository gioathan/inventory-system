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
            item.DiscountPercentage,
            item.EffectivePrice,
            item.ImageUrl,
            item.CategoryId,
            stockBySku.TryGetValue(item.Sku, out var quantity) ? quantity : null));
    }

    // Answers "what came in, what sold and what was it worth" for one session's period, per item.
    // Revenue is what was actually paid for sales that recorded their price (since 2026-09-28);
    // units sold before that are priced at today's effective price and the line is flagged
    // RevenueEstimated. Category is the item's current one, joined from Catalog here.
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
            var estimated = line.UnpricedSold > 0;
            // Unpriced (older) sales can only be valued at today's price; without the item there's
            // no price at all, so the total is unknown rather than silently too low.
            decimal? revenue = !estimated
                ? line.RecordedRevenue
                : item is null ? null : line.RecordedRevenue + item.EffectivePrice * line.UnpricedSold;

            return new SessionReportLine(
                line.Sku,
                item?.Name,
                item?.CategoryId,
                line.Restocked,
                line.Sold,
                line.NetDelta,
                line.OpeningQuantity,
                line.ClosingQuantity,
                revenue,
                estimated);
        });
    }
}

public record DashboardItem(
    string Sku, string Name, string Barcode, decimal Price, double? DiscountPercentage, decimal EffectivePrice,
    string? ImageUrl, Guid? CategoryId, int? QuantityOnHand);
public record SessionReportLine(
    string Sku, string? Name, Guid? CategoryId, int Restocked, int Sold, int NetDelta,
    int OpeningQuantity, int ClosingQuantity, decimal? Revenue, bool RevenueEstimated);
