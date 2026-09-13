using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Staff.Api.Data;

public class StaffDbContext(DbContextOptions<StaffDbContext> options) : DbContext(options)
{
    public DbSet<StaffUser> StaffUsers => Set<StaffUser>();
    public DbSet<AuditLogEntry> AuditLogEntries => Set<AuditLogEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StaffUser>(entity =>
        {
            entity.Property(e => e.Username).IsRequired().HasMaxLength(64);
            entity.HasIndex(e => e.Username).IsUnique();
        });

        modelBuilder.Entity<AuditLogEntry>(entity =>
        {
            entity.HasIndex(e => e.Timestamp);
        });
    }
}
