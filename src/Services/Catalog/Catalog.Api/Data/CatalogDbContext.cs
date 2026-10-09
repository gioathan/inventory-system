using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Data;

public class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Item> Items => Set<Item>();
    public DbSet<DatedDiscount> DatedDiscounts => Set<DatedDiscount>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Category>(entity =>
        {
            entity.Property(e => e.Name).IsRequired().HasMaxLength(128);
            entity.HasIndex(e => e.Name).IsUnique();
            // Restrict: a category with sub-categories can't be deleted out from under them.
            entity.HasOne<Category>().WithMany().HasForeignKey(e => e.ParentId).OnDelete(DeleteBehavior.Restrict);
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

        modelBuilder.Entity<DatedDiscount>(entity =>
        {
            entity.Property(e => e.Name).IsRequired().HasMaxLength(128);
            entity.HasMany(e => e.Periods).WithOne().HasForeignKey(p => p.DatedDiscountId).OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(e => e.Items).WithOne().HasForeignKey(i => i.DatedDiscountId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DatedDiscountItem>(entity =>
        {
            entity.HasKey(e => new { e.DatedDiscountId, e.Sku });
            entity.Property(e => e.Sku).HasMaxLength(64);
        });
    }
}
