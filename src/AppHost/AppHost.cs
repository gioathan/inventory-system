var builder = DistributedApplication.CreateBuilder(args);

// AddPostgres spins up a Postgres container for local dev; WithDataVolume persists its data
// across `dotnet run` restarts so you don't lose stock data every time you stop the AppHost.
//
// The password is pinned to a fixed literal rather than left auto-generated: Aspire generates
// a fresh random password on every single launch by default, but Postgres only ever applies
// POSTGRES_PASSWORD on first-time initialization of an empty data directory — on every restart
// after that it silently keeps whatever was baked in at that first init. Combined with
// WithDataVolume(), an auto-generated password means every restart after the first one fails
// with "password authentication failed" forever, since the new random password never matches
// what's already on disk. A stable literal sidesteps that entirely. Local dev only — never do
// this for a real secret.
var postgresPassword = builder.AddParameter("postgres-password", "local-dev-only-password", secret: true);
var postgres = builder.AddPostgres("postgres", password: postgresPassword)
    .WithDataVolume();

var inventoryDb = postgres.AddDatabase("inventorydb");
var catalogDb = postgres.AddDatabase("catalogdb");
var staffDb = postgres.AddDatabase("staffdb");

// Same reasoning as postgres-password: this has to be byte-for-byte identical across every
// service's process (Staff.Api signs with it, everyone else validates with it) and stable
// across restarts, or token validation breaks the moment any service restarts with a freshly
// generated value. Local dev only — a real deployment would pull this from a real secret store.
var jwtSigningKey = builder.AddParameter("jwt-signing-key", "local-dev-only-signing-key-do-not-use-in-prod", secret: true);

// Optional: the "upload a raw file, get back a URL" path for Item.ImageUrl (POST /images on
// Scan Gateway) — see architecture.md. Empty by default and deliberately not pinned to a
// working local-dev value like the parameters above, because there's no local Cloudflare to
// point at; the feature just reports "not configured" (502) until real values are supplied.
// Override locally via `dotnet user-secrets set Parameters:cloudflare-api-token <token>` (from
// src/AppHost) once you have a Cloudflare account with Images enabled.
var cloudflareAccountId = builder.AddParameter("cloudflare-account-id", "");
var cloudflareApiToken = builder.AddParameter("cloudflare-api-token", "", secret: true);

// RabbitMQ backs Inventory's transactional outbox (see StockReceivingService) — every stock
// movement publishes a StockMovementRecorded event here. Deliberately NOT WithDataVolume():
// Aspire generates a fresh random password per launch, but a persisted volume keeps whatever
// password was baked in on its first run — the next launch's new password then doesn't match,
// and RabbitMQ rejects every connection forever (same failure mode hit and fixed for Postgres
// in TECH_DEBT.md). Losing queued/unacked messages on an AppHost restart is an acceptable
// tradeoff for local dev; not worth reproducing that bug to avoid it.
var rabbitmq = builder.AddRabbitMQ("rabbitmq");

// Notification.Api is the only consumer today (low-stock alerts); Reporting will be a second
// subscriber on the same queue once it exists, with no change needed on the publishing side.
var mongo = builder.AddMongoDB("mongo");
var notificationDb = mongo.AddDatabase("notificationdb");

// Staff.Api issues and validates JWTs (it's also a caller of its own /staff and /audit-log
// endpoints, hence needing the signing key itself too). Every other service only validates.
builder.AddProject<Projects.InventorySystem_Staff_Api>("staff-api")
    .WithReference(staffDb)
    .WaitFor(staffDb)
    .WithEnvironment("Jwt__SigningKey", jwtSigningKey);

// WithReference injects the resolved connection string into Inventory.Api's config at the
// key "inventorydb", which builder.AddNpgsqlDbContext<InventoryDbContext>("inventorydb")
// picks up. WaitFor makes Aspire hold off starting the API until Postgres is ready.
var inventoryApi = builder.AddProject<Projects.InventorySystem_Inventory_Api>("inventory-api")
    .WithReference(inventoryDb)
    .WithReference(rabbitmq)
    .WaitFor(inventoryDb)
    .WaitFor(rabbitmq)
    .WithEnvironment("Jwt__SigningKey", jwtSigningKey);

builder.AddProject<Projects.InventorySystem_Notification_Api>("notification-api")
    .WithReference(notificationDb)
    .WithReference(rabbitmq)
    .WaitFor(notificationDb)
    .WaitFor(rabbitmq)
    .WithEnvironment("Jwt__SigningKey", jwtSigningKey);

// Catalog gets its own logical database on the same Postgres server (separate schema from
// Inventory, so no cross-service joins are even possible) rather than its own container —
// one container is plenty for local dev, and each service still owns its own database.
var catalogApi = builder.AddProject<Projects.InventorySystem_Catalog_Api>("catalog-api")
    .WithReference(catalogDb)
    .WaitFor(catalogDb)
    .WithEnvironment("Jwt__SigningKey", jwtSigningKey);

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
    .WaitFor(redis)
    .WithEnvironment("Jwt__SigningKey", jwtSigningKey)
    .WithEnvironment("CloudflareImages__AccountId", cloudflareAccountId)
    .WithEnvironment("CloudflareImages__ApiToken", cloudflareApiToken);

// Dashboard.Api is the one GraphQL surface in the system (see architecture.md) — it composes
// Catalog and Inventory into a single client-shaped query, still over REST for now.
builder.AddProject<Projects.InventorySystem_Dashboard_Api>("dashboard-api")
    .WithReference(catalogApi)
    .WithReference(inventoryApi)
    .WaitFor(catalogApi)
    .WaitFor(inventoryApi)
    .WithEnvironment("Jwt__SigningKey", jwtSigningKey);

builder.Build().Run();
