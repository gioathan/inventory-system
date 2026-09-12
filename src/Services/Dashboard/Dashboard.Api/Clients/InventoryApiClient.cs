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
            .Select(l => new SessionSummaryLine(l.Sku, l.Restocked, l.Sold, l.NetDelta))
            .ToList();
    }
}

public record StockLevel(string Sku, int QuantityOnHand);
public record SessionSummaryLine(string Sku, int Restocked, int Sold, int NetDelta);
