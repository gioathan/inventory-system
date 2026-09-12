using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Endpoints;
using InventorySystem.Inventory.Api.Grpc;
using InventorySystem.Inventory.Api.Services;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// "inventorydb" matches the name AppHost.cs gives this database resource; Aspire resolves
// the actual connection string (host, port, credentials) from that reference at startup.
builder.AddNpgsqlDbContext<InventoryDbContext>("inventorydb");

builder.Services.AddOpenApi();

// REST is for direct/manual API access; gRPC below is for everything Scan Gateway and
// Dashboard call internally, reads and writes alike — both bind to the same Kestrel HTTPS
// endpoint, negotiated per-request via ALPN.
builder.Services.AddGrpc();

builder.Services.AddScoped<StockReceivingService>();
builder.Services.AddScoped<RestockSessionService>();

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
