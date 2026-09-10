var builder = DistributedApplication.CreateBuilder(args);

// AddPostgres spins up a Postgres container for local dev; WithDataVolume persists its data
// across `dotnet run` restarts so you don't lose stock data every time you stop the AppHost.
var postgres = builder.AddPostgres("postgres")
    .WithDataVolume();

var inventoryDb = postgres.AddDatabase("inventorydb");
var catalogDb = postgres.AddDatabase("catalogdb");

// WithReference injects the resolved connection string into Inventory.Api's config at the
// key "inventorydb", which builder.AddNpgsqlDbContext<InventoryDbContext>("inventorydb")
// picks up. WaitFor makes Aspire hold off starting the API until Postgres is ready.
var inventoryApi = builder.AddProject<Projects.InventorySystem_Inventory_Api>("inventory-api")
    .WithReference(inventoryDb)
    .WaitFor(inventoryDb);

// Catalog gets its own logical database on the same Postgres server (separate schema from
// Inventory, so no cross-service joins are even possible) rather than its own container —
// one container is plenty for local dev, and each service still owns its own database.
var catalogApi = builder.AddProject<Projects.InventorySystem_Catalog_Api>("catalog-api")
    .WithReference(catalogDb)
    .WaitFor(catalogDb);

// Redis backs Scan Gateway's barcode->item cache only — nothing else references it, so
// there's no risk of it accidentally ending up on the live-stock-read path.
var redis = builder.AddRedis("redis");

// Scan Gateway has no database of its own — it's a stateless orchestrator. WithReference here
// (on the project resources, not a database) is what makes "https+http://catalog-api" and
// "https+http://inventory-api" resolvable from inside ScanGateway.Api via service discovery.
builder.AddProject<Projects.InventorySystem_ScanGateway_Api>("scan-gateway")
    .WithReference(catalogApi)
    .WithReference(inventoryApi)
    .WithReference(redis)
    .WaitFor(catalogApi)
    .WaitFor(inventoryApi)
    .WaitFor(redis);

// Dashboard.Api is the one GraphQL surface in the system (see architecture.md) — it composes
// Catalog and Inventory into a single client-shaped query, still over REST for now.
builder.AddProject<Projects.InventorySystem_Dashboard_Api>("dashboard-api")
    .WithReference(catalogApi)
    .WithReference(inventoryApi)
    .WaitFor(catalogApi)
    .WaitFor(inventoryApi);

builder.Build().Run();
