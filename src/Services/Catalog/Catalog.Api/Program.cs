using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Endpoints;
using InventorySystem.Catalog.Api.Grpc;
using InventorySystem.Catalog.Api.Services;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// "catalogdb" matches the name AppHost.cs gives this database resource.
builder.AddNpgsqlDbContext<CatalogDbContext>("catalogdb");

builder.Services.AddOpenApi();

// REST is for direct/manual API access (categories, admin item creation); gRPC below is for
// everything Scan Gateway and Dashboard call internally, reads and writes alike — both bind
// to the same Kestrel HTTPS endpoint, negotiated per-request via ALPN.
builder.Services.AddGrpc();

builder.Services.AddScoped<ItemCreationService>();

var app = builder.Build();

app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(); // interactive REST explorer at /scalar — dev-only, browses the same OpenAPI doc MapOpenApi() exposes

    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Database.Migrate();
}

app.UseHttpsRedirection();

app.MapCatalogEndpoints();
app.MapGrpcService<CatalogGrpcServiceImpl>();

app.Run();
