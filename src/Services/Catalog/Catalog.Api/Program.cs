using InventorySystem.Auth.Contracts;
using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Grpc;
using InventorySystem.Catalog.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddInventorySystemJwtAuth(builder.Configuration);

// "catalogdb" matches the name AppHost.cs gives this database resource.
builder.AddNpgsqlDbContext<CatalogDbContext>("catalogdb");

// gRPC is the only surface here — every REST route this service used to expose (items,
// categories) had a gRPC twin that Scan Gateway/Dashboard already called internally; the
// REST duplicates were removed rather than kept as a second, unused way to reach the same
// logic. No OpenAPI/Scalar either — nothing left for it to document.
builder.Services.AddGrpc();

builder.Services.AddScoped<ItemCreationService>();

var app = builder.Build();

app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Database.Migrate();
}

// Deliberately no UseHttpsRedirection(): it 307-redirects any plain-HTTP request to HTTPS,
// and .NET's HttpClient strips the Authorization header when following a cross-scheme redirect
// (a deliberate security behavior) — the bearer token never reaches auth middleware at all.
// Both schemes are already bound side by side; nothing forces one into the other.
app.UseAuthentication();
app.UseAuthorization();

app.MapGrpcService<CatalogGrpcServiceImpl>();

app.Run();
