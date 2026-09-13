using InventorySystem.Auth.Contracts;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.Grpc.Contracts.Inventory;
using InventorySystem.ScanGateway.Api.Clients;
using InventorySystem.ScanGateway.Api.Endpoints;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddInventorySystemJwtAuth(builder.Configuration);

// Needed so the bearer-forwarding callback below can read the caller's own incoming token —
// Catalog/Inventory validate that same token themselves, so whoever called Scan Gateway needs
// to already be authorized for whatever internal RPC this triggers, not just for the REST call.
builder.Services.AddHttpContextAccessor();

// gRPC needs HTTP/2, so unlike the REST clients' "https+http://" (try https, fall back to
// http), this must commit to a single scheme up front — GrpcChannel inspects the URI scheme
// itself to pick a resolver and doesn't understand the compound one. Service discovery still
// resolves "catalog-api" to a real address underneath, via the same HttpClientFactory pipeline
// AddGrpcClient is built on.
builder.Services.AddGrpcClient<CatalogGrpcService.CatalogGrpcServiceClient>(o =>
{
    o.Address = new Uri("https://catalog-api");
}).AddCallCredentials(ForwardBearerToken);
builder.Services.AddGrpcClient<InventoryGrpcService.InventoryGrpcServiceClient>(o =>
{
    o.Address = new Uri("https://inventory-api");
}).AddCallCredentials(ForwardBearerToken);

static Task ForwardBearerToken(global::Grpc.Core.AuthInterceptorContext context, global::Grpc.Core.Metadata metadata, IServiceProvider serviceProvider)
{
    var httpContext = serviceProvider.GetRequiredService<IHttpContextAccessor>().HttpContext;
    var authHeader = httpContext?.Request.Headers.Authorization.ToString();
    if (!string.IsNullOrEmpty(authHeader))
        metadata.Add("Authorization", authHeader);
    return Task.CompletedTask;
}

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

// Deliberately no UseHttpsRedirection() — see architecture.md / TECH_DEBT.md: it strips the
// Authorization header on the redirect it issues for any plain-HTTP request.
app.UseAuthentication();
app.UseAuthorization();

app.MapScanEndpoints();
app.MapReceivingEndpoints();
app.MapCategoryEndpoints();

app.Run();
