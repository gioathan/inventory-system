using InventorySystem.Auth.Contracts;
using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Endpoints;

public static class StockEndpoints
{
    public static void MapStockEndpoints(this WebApplication app)
    {
        // The only REST route left here. GetStock/ListStock/AdjustStock/ReceiveStock all moved
        // to gRPC-only once Scan Gateway/Dashboard were confirmed as the sole internal callers —
        // this one stays because nothing (not even gRPC) covers "create a stock row directly at
        // an exact quantity, failing if one already exists," which the concurrency test relies
        // on for a clean starting fixture.
        app.MapPost("/stock", async (CreateStockItemRequest request, InventoryDbContext db, StockReceivingService receiving) =>
        {
            if (await db.StockItems.AnyAsync(s => s.Sku == request.Sku))
                return Results.Conflict($"Stock item '{request.Sku}' already exists.");

            var item = new StockItem
            {
                Id = Guid.NewGuid(),
                Sku = request.Sku,
                QuantityOnHand = request.InitialQuantity
            };

            db.StockItems.Add(item);
            await db.SaveChangesAsync();
            await receiving.LogMovementAsync(item.Sku, request.InitialQuantity, StockMovementReason.ManualAdjust, item.QuantityOnHand, CancellationToken.None);

            return Results.Created($"/stock/{item.Sku}", new StockResponse(item.Sku, item.QuantityOnHand));
        }).RequireAuthorization(AuthPolicies.AdminOnly);
    }
}

public record CreateStockItemRequest(string Sku, int InitialQuantity);
public record StockResponse(string Sku, int QuantityOnHand);
