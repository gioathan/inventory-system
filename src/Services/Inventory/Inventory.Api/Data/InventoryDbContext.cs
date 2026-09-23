using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Data;

public class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options)
{
    public DbSet<StockItem> StockItems => Set<StockItem>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<RestockSession> RestockSessions => Set<RestockSession>();
    // Wolverine's EF Core integration persists saga state through whatever DbContext is already
    // enrolled in the outbox transaction — this DbSet is what makes PurchaseOrder eligible;
    // nothing else needs to reference it directly.
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StockItem>(entity =>
        {
            entity.Property(e => e.Sku).IsRequired().HasMaxLength(64);
            entity.HasIndex(e => e.Sku).IsUnique();
        });

        modelBuilder.Entity<StockMovement>(entity =>
        {
            entity.Property(e => e.Sku).IsRequired().HasMaxLength(64);
            // Every report/history query filters by Sku+time or by SessionId — index both access paths.
            entity.HasIndex(e => new { e.Sku, e.Timestamp });
            entity.HasIndex(e => e.SessionId);
        });

        modelBuilder.Entity<RestockSession>(entity =>
        {
            // Enforces "only one open session at a time" at the database level, not just in
            // application code — a partial unique index on rows where ClosedAt is still null.
            entity.HasIndex(e => e.ClosedAt)
                .IsUnique()
                .HasFilter("\"ClosedAt\" IS NULL");
        });

        modelBuilder.Entity<PurchaseOrder>(entity =>
        {
            // Lines belong entirely to their PurchaseOrder — no independent identity or query
            // path of their own — so they're an owned collection (its own table, FK'd back to
            // PurchaseOrder, no separate DbSet) rather than a full second aggregate.
            entity.OwnsMany(e => e.Lines, line =>
            {
                line.WithOwner().HasForeignKey("PurchaseOrderId");
                line.HasKey(l => l.Id);
                line.Property(l => l.Sku).IsRequired().HasMaxLength(64);
            });
        });
    }
}
