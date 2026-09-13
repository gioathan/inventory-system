using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace InventorySystem.Staff.Api.Data;

// Used only by `dotnet ef` design-time tooling. At runtime, Aspire injects the real
// connection string via AddNpgsqlDbContext in Program.cs — this class is never hit then.
public class StaffDbContextFactory : IDesignTimeDbContextFactory<StaffDbContext>
{
    public StaffDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<StaffDbContext>();
        optionsBuilder.UseNpgsql("Host=localhost;Database=staffdb;Username=postgres;Password=postgres");
        return new StaffDbContext(optionsBuilder.Options);
    }
}
