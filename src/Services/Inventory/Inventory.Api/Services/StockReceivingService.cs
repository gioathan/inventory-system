using InventorySystem.Inventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Services;

public class StockReceivingService(InventoryDbContext db)
{
    // Atomic upsert-add: creates the row at `quantity` if this Sku has no stock record yet,
    // otherwise adds `quantity` to whatever's already there — a single statement, so two
    // concurrent "receive" calls for a brand-new Sku can't both try to create it and race.
    public async Task<StockItem> ReceiveStockAsync(string sku, int quantity, CancellationToken cancellationToken)
    {
        if (quantity <= 0)
            throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");

        var results = await db.StockItems.FromSqlInterpolated($"""
            INSERT INTO "StockItems" ("Id", "Sku", "QuantityOnHand")
            VALUES ({Guid.NewGuid()}, {sku}, {quantity})
            ON CONFLICT ("Sku") DO UPDATE SET "QuantityOnHand" = "StockItems"."QuantityOnHand" + {quantity}
            RETURNING *
            """).AsNoTracking().ToListAsync(cancellationToken);

        return results.Single();
    }
}
