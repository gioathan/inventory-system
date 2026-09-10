using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Endpoints;

public static class StockEndpoints
{
    public static void MapStockEndpoints(this WebApplication app)
    {
        app.MapGet("/stock/{sku}", async (string sku, InventoryDbContext db) =>
        {
            var item = await db.StockItems.AsNoTracking().FirstOrDefaultAsync(s => s.Sku == sku);
            return item is null
                ? Results.NotFound()
                : Results.Ok(new StockResponse(item.Sku, item.QuantityOnHand));
        });

        // Dashboard.Api's GraphQL resolvers call this to build the stock side of the
        // composed dashboard query — no single-item lookup covers "give me everything".
        app.MapGet("/stock", async (InventoryDbContext db) =>
        {
            var items = await db.StockItems.AsNoTracking()
                .Select(s => new StockResponse(s.Sku, s.QuantityOnHand))
                .ToListAsync();
            return Results.Ok(items);
        });

        app.MapPost("/stock", async (CreateStockItemRequest request, InventoryDbContext db) =>
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

            return Results.Created($"/stock/{item.Sku}", new StockResponse(item.Sku, item.QuantityOnHand));
        });

        app.MapPost("/stock/{sku}/adjust", async (string sku, AdjustStockRequest request, InventoryDbContext db) =>
        {
            // Single atomic UPDATE with the guard in the WHERE clause: the database evaluates
            // "would this go negative?" and applies the change in the same operation, so two
            // concurrent requests can never both read 1-in-stock and both decrement to -1.
            var rowsAffected = await db.StockItems
                .Where(s => s.Sku == sku && s.QuantityOnHand + request.Delta >= 0)
                .ExecuteUpdateAsync(setters =>
                    setters.SetProperty(s => s.QuantityOnHand, s => s.QuantityOnHand + request.Delta));

            if (rowsAffected == 0)
            {
                var exists = await db.StockItems.AnyAsync(s => s.Sku == sku);
                return exists
                    ? Results.Conflict($"Insufficient stock for '{sku}'.")
                    : Results.NotFound();
            }

            var updated = await db.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
            return Results.Ok(new StockResponse(updated.Sku, updated.QuantityOnHand));
        });

        // "Receive" stock: create the row at the given quantity if it doesn't exist yet,
        // otherwise add to what's there. This is what Scan Gateway's intake/restock flows
        // call — distinct from POST /stock (fails if it already exists) and /adjust (fails
        // if it doesn't).
        app.MapPost("/stock/{sku}/receive", async (string sku, ReceiveStockRequest request, StockReceivingService receiving, CancellationToken cancellationToken) =>
        {
            if (request.Quantity <= 0)
                return Results.BadRequest("Quantity must be positive.");

            var item = await receiving.ReceiveStockAsync(sku, request.Quantity, cancellationToken);
            return Results.Ok(new StockResponse(item.Sku, item.QuantityOnHand));
        });
    }
}

public record CreateStockItemRequest(string Sku, int InitialQuantity);
public record AdjustStockRequest(int Delta);
public record ReceiveStockRequest(int Quantity);
public record StockResponse(string Sku, int QuantityOnHand);
