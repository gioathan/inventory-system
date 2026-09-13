using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Endpoints;
using InventorySystem.Inventory.Api.Grpc;
using InventorySystem.Inventory.Api.Services;
using InventorySystem.Messaging.Contracts.Events;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using Wolverine;
using Wolverine.EntityFrameworkCore;
using Wolverine.Postgresql;
using Wolverine.RabbitMQ;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// "inventorydb" matches the name AppHost.cs gives this database resource; Aspire resolves
// the actual connection string (host, port, credentials) from that reference at startup.
builder.AddNpgsqlDbContext<InventoryDbContext>("inventorydb");

// Wolverine's own durability store (its outbox/inbox envelope tables) lives in the same
// Postgres server as the domain data, in its own schema — a separate concern from EF's
// InventoryDbContext, but no separate database to stand up for it.
var postgresConnectionString = builder.Configuration.GetConnectionString("inventorydb")
    ?? throw new InvalidOperationException("Missing 'inventorydb' connection string.");
var rabbitConnectionString = builder.Configuration.GetConnectionString("rabbitmq")
    ?? throw new InvalidOperationException("Missing 'rabbitmq' connection string.");

builder.Host.UseWolverine(opts =>
{
    opts.PersistMessagesWithPostgresql(postgresConnectionString);
    opts.UseRabbitMq(new Uri(rabbitConnectionString)).AutoProvision();

    // Every StockMovementRecorded publish (see StockReceivingService) goes to this one queue —
    // Notification.Api is the only consumer today, but any future subscriber (Reporting) just
    // adds its own listener on the same queue/exchange, no change needed here.
    opts.PublishMessage<StockMovementRecorded>().ToRabbitQueue("stock-movements");
});

builder.Services.AddOpenApi();

// REST is for direct/manual API access; gRPC below is for everything Scan Gateway and
// Dashboard call internally, reads and writes alike — both bind to the same Kestrel HTTPS
// endpoint, negotiated per-request via ALPN.
builder.Services.AddGrpc();

builder.Services.AddScoped<StockReceivingService>();
builder.Services.AddScoped<RestockSessionService>();

// The concrete DbContextOutbox implementation Enroll()s whatever DbContext we hand it at
// publish time (see StockReceivingService), so one registration covers InventoryDbContext
// without needing Wolverine to own its registration.
builder.Services.AddScoped<IDbContextOutbox, DbContextOutbox>();

var app = builder.Build();

app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(); // interactive REST explorer at /scalar — dev-only, browses the same OpenAPI doc MapOpenApi() exposes

    // Applying migrations here on startup is a dev-only convenience — no separate
    // migration step to remember before running against the Aspire-managed Postgres.
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.Migrate();
}

app.UseHttpsRedirection();

app.MapStockEndpoints();
app.MapRestockSessionEndpoints();
app.MapGrpcService<InventoryGrpcServiceImpl>();

app.Run();
