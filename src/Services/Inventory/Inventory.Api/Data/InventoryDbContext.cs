using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Data;

public class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options)
{
    public DbSet<StockItem> StockItems => Set<StockItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StockItem>(entity =>
        {
            entity.Property(e => e.Sku).IsRequired().HasMaxLength(64);
            entity.HasIndex(e => e.Sku).IsUnique();
        });
    }
}
