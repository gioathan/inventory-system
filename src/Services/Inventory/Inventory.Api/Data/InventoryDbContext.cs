using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Data;

public class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options)
{
    public DbSet<StockItem> StockItems => Set<StockItem>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<RestockSession> RestockSessions => Set<RestockSession>();

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
    }
}
