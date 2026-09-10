using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace InventorySystem.Catalog.Api.Data;

// Used only by `dotnet ef` design-time tooling. At runtime, Aspire injects the real
// connection string via AddNpgsqlDbContext in Program.cs — this class is never hit then.
public class CatalogDbContextFactory : IDesignTimeDbContextFactory<CatalogDbContext>
{
    public CatalogDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<CatalogDbContext>();
        optionsBuilder.UseNpgsql("Host=localhost;Database=catalogdb;Username=postgres;Password=postgres");
        return new CatalogDbContext(optionsBuilder.Options);
    }
}
