using InventorySystem.Inventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Services;

public class StockReceivingService(InventoryDbContext db)
{
    // Atomic upsert-add: creates the row at `quantity` if this Sku has no stock record yet,
    // otherwise adds `quantity` to whatever's already there — a single statement, so two
    // concurrent "receive" calls for a brand-new Sku can't both try to create it and race.
    public async Task<StockItem> ReceiveStockAsync(
        string sku, int quantity, StockMovementReason reason, CancellationToken cancellationToken)
    {
        if (quantity <= 0)
            throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");

        // The upsert and the ledger write must land together — a receive that updated stock but
        // failed to log (or vice versa) would make the ledger lie about the current total.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var results = await db.StockItems.FromSqlInterpolated($"""
            INSERT INTO "StockItems" ("Id", "Sku", "QuantityOnHand")
            VALUES ({Guid.NewGuid()}, {sku}, {quantity})
            ON CONFLICT ("Sku") DO UPDATE SET "QuantityOnHand" = "StockItems"."QuantityOnHand" + {quantity}
            RETURNING *
            """).AsNoTracking().ToListAsync(cancellationToken);

        var item = results.Single();

        await LogMovementAsync(sku, quantity, reason, item.QuantityOnHand, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return item;
    }

    // Shared by ReceiveStockAsync and StockEndpoints' /adjust so every quantity change — no
    // matter which path caused it — ends up in the same ledger, tagged with whichever session
    // (if any) is currently open.
    public async Task LogMovementAsync(
        string sku, int delta, StockMovementReason reason, int resultingQuantity, CancellationToken cancellationToken)
    {
        var openSessionId = await db.RestockSessions
            .Where(s => s.ClosedAt == null)
            .Select(s => (Guid?)s.Id)
            .FirstOrDefaultAsync(cancellationToken);

        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.NewGuid(),
            Sku = sku,
            Delta = delta,
            Reason = reason,
            Timestamp = DateTimeOffset.UtcNow,
            ResultingQuantity = resultingQuantity,
            SessionId = openSessionId
        });

        await db.SaveChangesAsync(cancellationToken);
    }
}
