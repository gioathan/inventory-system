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

    public async Task<PurchaseOrder> CreatePurchaseOrderAsync(
        string supplierName, IEnumerable<PurchaseOrderLine> lines, CancellationToken cancellationToken)
    {
        var request = new CreatePurchaseOrderRequest { SupplierName = supplierName };
        request.Lines.AddRange(lines.Select(l => new PurchaseOrderLineInput { Sku = l.Sku, Quantity = l.Quantity }));

        var reply = await grpcClient.CreatePurchaseOrderAsync(request, cancellationToken: cancellationToken);
        return ToPurchaseOrder(reply);
    }

    public async Task<PurchaseOrder?> SendPurchaseOrderAsync(Guid id, CancellationToken cancellationToken) =>
        await InvokeOrNullAsync(() => grpcClient.SendPurchaseOrderAsync(
            new PurchaseOrderIdRequest { PurchaseOrderId = id.ToString() }, cancellationToken: cancellationToken).ResponseAsync);

    public async Task<PurchaseOrder?> ReceivePurchaseOrderShipmentAsync(
        Guid id, IEnumerable<PurchaseOrderLine> lines, CancellationToken cancellationToken)
    {
        var request = new ReceivePurchaseOrderShipmentRequest { PurchaseOrderId = id.ToString() };
        request.Lines.AddRange(lines.Select(l => new PurchaseOrderLineInput { Sku = l.Sku, Quantity = l.Quantity }));

        return await InvokeOrNullAsync(() => grpcClient.ReceivePurchaseOrderShipmentAsync(request, cancellationToken: cancellationToken).ResponseAsync);
    }

    public async Task<PurchaseOrder?> CancelPurchaseOrderAsync(Guid id, CancellationToken cancellationToken) =>
        await InvokeOrNullAsync(() => grpcClient.CancelPurchaseOrderAsync(
            new PurchaseOrderIdRequest { PurchaseOrderId = id.ToString() }, cancellationToken: cancellationToken).ResponseAsync);

    public async Task<PurchaseOrder?> GetPurchaseOrderAsync(Guid id, CancellationToken cancellationToken) =>
        await InvokeOrNullAsync(() => grpcClient.GetPurchaseOrderAsync(
            new PurchaseOrderIdRequest { PurchaseOrderId = id.ToString() }, cancellationToken: cancellationToken).ResponseAsync);

    public async Task<List<PurchaseOrder>> ListPurchaseOrdersAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListPurchaseOrdersAsync(new ListPurchaseOrdersRequest(), cancellationToken: cancellationToken);
        return reply.PurchaseOrders.Select(ToPurchaseOrder).ToList();
    }

    // NotFound and FailedPrecondition (an invalid state transition — see the saga's own Handle
    // methods) both become null here; the REST endpoint turns that into 404/409 respectively by
    // checking which one actually applies rather than losing the distinction.
    private static async Task<PurchaseOrder?> InvokeOrNullAsync(Func<Task<PurchaseOrderReply>> call)
    {
        try
        {
            return ToPurchaseOrder(await call());
        }
        catch (RpcException ex) when (ex.StatusCode is StatusCode.NotFound or StatusCode.FailedPrecondition)
        {
            throw new PurchaseOrderOperationException(ex.StatusCode, ex.Status.Detail);
        }
    }

    private static PurchaseOrder ToPurchaseOrder(PurchaseOrderReply reply) => new(
        Guid.Parse(reply.Id),
        reply.SupplierName,
        reply.Status.ToString(),
        reply.Lines.Select(l => new PurchaseOrderLine(l.Sku, l.OrderedQuantity) { ReceivedQuantity = l.ReceivedQuantity }).ToList(),
        DateTimeOffset.Parse(reply.OpenedAt),
        reply.HasClosedAt ? DateTimeOffset.Parse(reply.ClosedAt) : null);
}

public record StockLevel(string Sku, int QuantityOnHand);
public enum SellOutcome { Sold, NotFound, InsufficientStock }
public record SellResult(SellOutcome Outcome, StockLevel? Stock);

public record PurchaseOrderLine(string Sku, int Quantity)
{
    public int ReceivedQuantity { get; init; }
}

public record PurchaseOrder(
    Guid Id, string SupplierName, string Status, List<PurchaseOrderLine> Lines,
    DateTimeOffset OpenedAt, DateTimeOffset? ClosedAt);

public class PurchaseOrderOperationException(StatusCode statusCode, string message) : Exception(message)
{
    public StatusCode StatusCode { get; } = statusCode;
}
