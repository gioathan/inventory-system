using InventorySystem.Grpc.Contracts.Inventory;

namespace InventorySystem.Dashboard.Api.Clients;

public class InventoryApiClient(InventoryGrpcService.InventoryGrpcServiceClient grpcClient)
{
    public async Task<List<StockLevel>> GetAllStockAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListStockAsync(new ListStockRequest(), cancellationToken: cancellationToken);

        return reply.Stock
            .Select(s => new StockLevel(s.Sku, s.QuantityOnHand))
            .ToList();
    }

    public async Task<List<SessionSummaryLine>> GetSessionSummaryAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        var reply = await grpcClient.GetSessionSummaryAsync(
            new GetSessionSummaryRequest { SessionId = sessionId.ToString() },
            cancellationToken: cancellationToken);

        return reply.Lines
            .Select(l => new SessionSummaryLine(
                l.Sku, l.Restocked, l.Sold, l.NetDelta, l.OpeningQuantity, l.ClosingQuantity,
                decimal.Parse(l.RecordedRevenue, System.Globalization.CultureInfo.InvariantCulture), l.UnpricedSold))
            .ToList();
    }

    // Sales and receipts per calendar day of the shop, between two instants (`to` null = now).
    public async Task<List<DailySales>> GetDailySalesAsync(DateTimeOffset from, DateTimeOffset? to, CancellationToken cancellationToken)
    {
        var request = new GetDailySalesRequest { From = from.ToString("O", System.Globalization.CultureInfo.InvariantCulture) };
        if (to is { } end)
            request.To = end.ToString("O", System.Globalization.CultureInfo.InvariantCulture);

        var reply = await grpcClient.GetDailySalesAsync(request, cancellationToken: cancellationToken);
        return reply.Days
            .Select(d => new DailySales(
                d.Date, d.UnitsSold, d.UnitsReceived,
                decimal.Parse(d.RecordedRevenue, System.Globalization.CultureInfo.InvariantCulture), d.UnpricedSold))
            .ToList();
    }

    public async Task<List<ItemSales>> GetSalesByItemAsync(DateTimeOffset from, DateTimeOffset? to, CancellationToken cancellationToken)
    {
        var request = new GetSalesByItemRequest { From = from.ToString("O", System.Globalization.CultureInfo.InvariantCulture) };
        if (to is { } end)
            request.To = end.ToString("O", System.Globalization.CultureInfo.InvariantCulture);

        var reply = await grpcClient.GetSalesByItemAsync(request, cancellationToken: cancellationToken);
        return reply.Items
            .Select(i => new ItemSales(i.Sku, i.UnitsSold, decimal.Parse(i.RecordedRevenue, System.Globalization.CultureInfo.InvariantCulture)))
            .ToList();
    }
}

public record ItemSales(string Sku, int UnitsSold, decimal Revenue);
public record StockLevel(string Sku, int QuantityOnHand);
public record DailySales(string Date, int UnitsSold, int UnitsReceived, decimal Revenue, int UnpricedSold);
public record SessionSummaryLine(
    string Sku, int Restocked, int Sold, int NetDelta, int OpeningQuantity, int ClosingQuantity,
    decimal RecordedRevenue, int UnpricedSold);
