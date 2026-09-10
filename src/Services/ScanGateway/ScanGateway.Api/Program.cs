using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.Grpc.Contracts.Inventory;
using InventorySystem.ScanGateway.Api.Clients;
using InventorySystem.ScanGateway.Api.Endpoints;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// gRPC needs HTTP/2, so unlike the REST clients' "https+http://" (try https, fall back to
// http), this must commit to a single scheme up front — GrpcChannel inspects the URI scheme
// itself to pick a resolver and doesn't understand the compound one. Service discovery still
// resolves "catalog-api" to a real address underneath, via the same HttpClientFactory pipeline
// AddGrpcClient is built on.
builder.Services.AddGrpcClient<CatalogGrpcService.CatalogGrpcServiceClient>(o =>
{
    o.Address = new Uri("https://catalog-api");
});
builder.Services.AddGrpcClient<InventoryGrpcService.InventoryGrpcServiceClient>(o =>
{
    o.Address = new Uri("https://inventory-api");
});

builder.Services.AddScoped<CatalogApiClient>();
builder.Services.AddScoped<InventoryApiClient>();

// Backs the barcode->item cache in CatalogApiClient only — Inventory's stock lookups never
// go through this, per the "no cache on the live-stock-read path" rule in architecture.md.
builder.AddRedisDistributedCache("redis");

builder.Services.AddOpenApi();

var app = builder.Build();

app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(); // interactive REST explorer at /scalar — dev-only, browses the same OpenAPI doc MapOpenApi() exposes
}

app.UseHttpsRedirection();

app.MapScanEndpoints();
app.MapReceivingEndpoints();

app.Run();
