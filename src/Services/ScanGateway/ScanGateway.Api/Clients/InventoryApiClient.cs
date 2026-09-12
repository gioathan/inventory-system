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

    // Scan-to-sell: quantity is always sent as a negative delta here so the caller (the /sell
    // endpoint) only ever deals in positive "how many did they sell" numbers.
    public async Task<SellResult> SellStockAsync(string sku, int quantity, CancellationToken cancellationToken)
    {
        try
        {
            var reply = await grpcClient.AdjustStockAsync(
                new AdjustStockRequest { Sku = sku, Delta = -quantity, Reason = MovementReason.Sale },
                cancellationToken: cancellationToken);
            return new SellResult(SellOutcome.Sold, new StockLevel(reply.Sku, reply.QuantityOnHand));
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            return new SellResult(SellOutcome.NotFound, null);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.FailedPrecondition)
        {
            return new SellResult(SellOutcome.InsufficientStock, null);
        }
    }
}

public record StockLevel(string Sku, int QuantityOnHand);
public enum SellOutcome { Sold, NotFound, InsufficientStock }
public record SellResult(SellOutcome Outcome, StockLevel? Stock);
