using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Inventory;

namespace InventorySystem.ScanGateway.Api.Clients;

public class InventoryApiClient(InventoryGrpcService.InventoryGrpcServiceClient grpcClient)
{
    public async Task<StockLevel?> GetStockAsync(string sku, CancellationToken cancellationToken)
    {
        try
        {
            var reply = await grpcClient.GetStockAsync(new GetStockRequest { Sku = sku }, cancellationToken: cancellationToken);
            return new StockLevel(reply.Sku, reply.QuantityOnHand);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<StockLevel> ReceiveStockAsync(string sku, int quantity, MovementReason reason, CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ReceiveStockAsync(
            new ReceiveStockRequest { Sku = sku, Quantity = quantity, Reason = reason },
            cancellationToken: cancellationToken);
        return new StockLevel(reply.Sku, reply.QuantityOnHand);
    }
}

public record StockLevel(string Sku, int QuantityOnHand);
