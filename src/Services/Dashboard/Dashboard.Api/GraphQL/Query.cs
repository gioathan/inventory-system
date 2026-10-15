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
            item.ActiveDiscountPercentage,
            item.DatedDiscountName,
            item.ImageUrl,
            item.CategoryId,
            item.Location,
            stockBySku.TryGetValue(item.Sku, out var quantity) ? quantity : null));
    }

    // Units sold, units received and revenue for each calendar day (the shop's own) between two
    // instants; `to` omitted means until now. Every day is present, quiet ones as zeros. Revenue
    // is what was paid on sales that recorded their price; UnpricedSold counts the units from
    // before prices were recorded (none since 2026-09-28). Admin-only: revenue data.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IEnumerable<DailySales>> DailySales(
        DateTimeOffset from,
        DateTimeOffset? to,
        [Service] InventoryApiClient inventory,
        CancellationToken cancellationToken) =>
        await inventory.GetDailySalesAsync(from, to, cancellationToken);

    // What each item sold between two instants (`to` omitted = until now), with its current name.
    // The calendar-based counterpart to SessionReport: "this week's best sellers", and the selling
    // pace behind "running out soon". Admin-only: revenue data.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IEnumerable<ItemSalesLine>> SalesByItem(
        DateTimeOffset from,
        DateTimeOffset? to,
        [Service] CatalogApiClient catalog,
        [Service] InventoryApiClient inventory,
        CancellationToken cancellationToken)
    {
        var salesTask = inventory.GetSalesByItemAsync(from, to, cancellationToken);
        var itemsTask = catalog.GetAllItemsAsync(cancellationToken);
        await Task.WhenAll(salesTask, itemsTask);

        var nameBySku = itemsTask.Result.ToDictionary(i => i.Sku, i => i.Name);
        return salesTask.Result.Select(s => new ItemSalesLine(s.Sku, nameBySku.GetValueOrDefault(s.Sku), s.UnitsSold, s.Revenue));
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
    // The discount setting EffectivePrice today (the manual DiscountPercentage or a dated discount,
    // whichever is bigger), and the dated discount's name when that is the one.
    double? ActiveDiscountPercentage, string? DatedDiscountName,
    string? ImageUrl, Guid? CategoryId,
    // Where the item is kept in storage; free text, null when not recorded.
    string? Location,
    int? QuantityOnHand);
public record ItemSalesLine(string Sku, string? Name, int UnitsSold, decimal Revenue);
public record SessionReportLine(
    string Sku, string? Name, Guid? CategoryId, int Restocked, int Sold, int NetDelta,
    int OpeningQuantity, int ClosingQuantity, decimal? Revenue, bool RevenueEstimated);
