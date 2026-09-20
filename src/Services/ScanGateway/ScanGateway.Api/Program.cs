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
//
// The scheme itself is configurable, not hardcoded: Aspire always gives every service a real
// HTTPS endpoint, but a plain Kubernetes Deployment (no TLS/mTLS yet — that's Step 11's service
// mesh, not Step 10) serves gRPC over cleartext HTTP/2 instead. Defaults match Aspire; k8s
// manifests override via GrpcClients__CatalogApi/GrpcClients__InventoryApi env vars.
var catalogApiAddress = builder.Configuration["GrpcClients:CatalogApi"] ?? "https://catalog-api";
var inventoryApiAddress = builder.Configuration["GrpcClients:InventoryApi"] ?? "https://inventory-api";

// GrpcChannel refuses to send call credentials (the bearer token) over a channel it considers
// insecure — a safeguard against leaking a token to an unintended plaintext endpoint. Cluster-
// internal traffic without TLS yet (see above) trips that safeguard even though it's fine here;
// UnsafeUseInsecureChannelCallCredentials is the documented opt-out. It's a no-op for the
// Aspire/HTTPS case, so this is safe to set unconditionally rather than branching on scheme.
builder.Services.AddGrpcClient<CatalogGrpcService.CatalogGrpcServiceClient>(o =>
{
    o.Address = new Uri(catalogApiAddress);
}).AddCallCredentials(ForwardBearerToken).ConfigureChannel(o => o.UnsafeUseInsecureChannelCallCredentials = true);
builder.Services.AddGrpcClient<InventoryGrpcService.InventoryGrpcServiceClient>(o =>
{
    o.Address = new Uri(inventoryApiAddress);
}).AddCallCredentials(ForwardBearerToken).ConfigureChannel(o => o.UnsafeUseInsecureChannelCallCredentials = true);

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
app.MapDiscountEndpoints();

app.Run();
