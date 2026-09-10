using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace InventorySystem.Inventory.Api.Data;

// Used only by `dotnet ef` design-time tooling. At runtime, Aspire injects the real
// connection string via AddNpgsqlDbContext in Program.cs — this class is never hit then.
public class InventoryDbContextFactory : IDesignTimeDbContextFactory<InventoryDbContext>
{
    public InventoryDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<InventoryDbContext>();
        optionsBuilder.UseNpgsql("Host=localhost;Database=inventorydb;Username=postgres;Password=postgres");
        return new InventoryDbContext(optionsBuilder.Options);
    }
}
