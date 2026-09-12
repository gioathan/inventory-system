using InventorySystem.Inventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Services;

public enum AdjustStockOutcome { Adjusted, NotFound, InsufficientStock }
public record AdjustStockResult(AdjustStockOutcome Outcome, StockItem? Item);

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

    // Single atomic UPDATE with the guard in the WHERE clause: the database evaluates "would
    // this go negative?" and applies the change in the same operation, so two concurrent
    // requests (e.g. two sellers scanning the last unit at once) can never both read 1-in-stock
    // and both decrement to -1. Shared by the REST /adjust endpoint and Scan Gateway's
    // scan-to-sell RPC — one implementation of the guard, not two copies that could drift.
    public async Task<AdjustStockResult> AdjustStockAsync(
        string sku, int delta, StockMovementReason reason, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var rowsAffected = await db.StockItems
            .Where(s => s.Sku == sku && s.QuantityOnHand + delta >= 0)
            .ExecuteUpdateAsync(setters =>
                setters.SetProperty(s => s.QuantityOnHand, s => s.QuantityOnHand + delta), cancellationToken);

        if (rowsAffected == 0)
        {
            var exists = await db.StockItems.AnyAsync(s => s.Sku == sku, cancellationToken);
            return new AdjustStockResult(exists ? AdjustStockOutcome.InsufficientStock : AdjustStockOutcome.NotFound, null);
        }

        var updated = await db.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku, cancellationToken);
        await LogMovementAsync(sku, delta, reason, updated.QuantityOnHand, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new AdjustStockResult(AdjustStockOutcome.Adjusted, updated);
    }

    // Shared by ReceiveStockAsync, AdjustStockAsync and StockEndpoints' POST /stock so every
    // quantity change — no matter which path caused it — ends up in the same ledger, tagged
    // with whichever session (if any) is currently open.
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
