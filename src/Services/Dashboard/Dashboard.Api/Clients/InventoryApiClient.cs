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
}

public record StockLevel(string Sku, int QuantityOnHand);
