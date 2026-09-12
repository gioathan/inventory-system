using global::Grpc.Core;
using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Services;
using InventorySystem.Grpc.Contracts.Inventory;
using Microsoft.EntityFrameworkCore;
// Both the domain layer and the generated proto define a "SessionSummaryLine" type; alias the
// wire-format one so usage below stays unambiguous without fully qualifying every reference.
using GrpcSessionSummaryLine = InventorySystem.Grpc.Contracts.Inventory.SessionSummaryLine;

namespace InventorySystem.Inventory.Api.Grpc;

public class InventoryGrpcServiceImpl(InventoryDbContext db, StockReceivingService receiving, RestockSessionService sessions) : InventoryGrpcService.InventoryGrpcServiceBase
{
    public override async Task<StockReply> GetStock(GetStockRequest request, ServerCallContext context)
    {
        var item = await db.StockItems.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Sku == request.Sku, context.CancellationToken);

        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No stock record found for SKU '{request.Sku}'."));

        return ToReply(item);
    }

    public override async Task<ListStockReply> ListStock(ListStockRequest request, ServerCallContext context)
    {
        var items = await db.StockItems.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListStockReply();
        reply.Stock.AddRange(items.Select(ToReply));
        return reply;
    }

    public override async Task<StockReply> ReceiveStock(ReceiveStockRequest request, ServerCallContext context)
    {
        if (request.Quantity <= 0)
            throw new RpcException(new Status(StatusCode.InvalidArgument, "Quantity must be positive."));

        var item = await receiving.ReceiveStockAsync(request.Sku, request.Quantity, ToDomainReason(request.Reason), context.CancellationToken);
        return ToReply(item);
    }

    // Scan Gateway's scan-to-sell action calls this with a negative Delta and Reason.Sale — the
    // same atomic floor-at-zero guard as the REST /adjust endpoint, just reachable internally.
    public override async Task<StockReply> AdjustStock(AdjustStockRequest request, ServerCallContext context)
    {
        var result = await receiving.AdjustStockAsync(request.Sku, request.Delta, ToDomainReason(request.Reason), context.CancellationToken);

        return result.Outcome switch
        {
            AdjustStockOutcome.NotFound => throw new RpcException(new Status(StatusCode.NotFound, $"No stock record found for SKU '{request.Sku}'.")),
            AdjustStockOutcome.InsufficientStock => throw new RpcException(new Status(StatusCode.FailedPrecondition, $"Insufficient stock for '{request.Sku}'.")),
            _ => ToReply(result.Item!)
        };
    }

    public override async Task<SessionSummaryReply> GetSessionSummary(GetSessionSummaryRequest request, ServerCallContext context)
    {
        if (!Guid.TryParse(request.SessionId, out var sessionId))
            throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{request.SessionId}' is not a valid session id."));

        var lines = await sessions.GetSummaryAsync(sessionId, context.CancellationToken);

        var reply = new SessionSummaryReply();
        reply.Lines.AddRange(lines.Select(l => new GrpcSessionSummaryLine
        {
            Sku = l.Sku,
            Restocked = l.Restocked,
            Sold = l.Sold,
            NetDelta = l.NetDelta
        }));
        return reply;
    }

    private static StockReply ToReply(StockItem item) =>
        new() { Sku = item.Sku, QuantityOnHand = item.QuantityOnHand };

    private static StockMovementReason ToDomainReason(MovementReason reason) => reason switch
    {
        MovementReason.Intake => StockMovementReason.Intake,
        MovementReason.Sale => StockMovementReason.Sale,
        MovementReason.ManualAdjust => StockMovementReason.ManualAdjust,
        _ => StockMovementReason.Restock
    };
}
