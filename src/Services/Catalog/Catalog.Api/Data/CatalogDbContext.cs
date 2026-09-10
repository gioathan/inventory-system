using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Data;

public class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Item> Items => Set<Item>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Category>(entity =>
        {
            entity.Property(e => e.Name).IsRequired().HasMaxLength(128);
            entity.HasIndex(e => e.Name).IsUnique();
        });

        modelBuilder.Entity<Item>(entity =>
        {
            entity.Property(e => e.Sku).IsRequired().HasMaxLength(64);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(256);
            entity.Property(e => e.Barcode).IsRequired().HasMaxLength(64);
            entity.Property(e => e.Price).HasColumnType("decimal(18,2)");
            entity.Property(e => e.ImageUrl).HasMaxLength(2048);
            entity.HasIndex(e => e.Sku).IsUnique();
            entity.HasIndex(e => e.Barcode).IsUnique();
        });
    }
}
