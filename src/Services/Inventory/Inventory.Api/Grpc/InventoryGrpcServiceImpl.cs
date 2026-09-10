using global::Grpc.Core;
using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Services;
using InventorySystem.Grpc.Contracts.Inventory;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Grpc;

public class InventoryGrpcServiceImpl(InventoryDbContext db, StockReceivingService receiving) : InventoryGrpcService.InventoryGrpcServiceBase
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

        var item = await receiving.ReceiveStockAsync(request.Sku, request.Quantity, context.CancellationToken);
        return ToReply(item);
    }

    private static StockReply ToReply(StockItem item) =>
        new() { Sku = item.Sku, QuantityOnHand = item.QuantityOnHand };
}
