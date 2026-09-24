using InventorySystem.Auth.Contracts;
using InventorySystem.Dashboard.Api.Clients;
using InventorySystem.Dashboard.Api.GraphQL;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.Grpc.Contracts.Inventory;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddInventorySystemJwtAuth(builder.Configuration);

// Needed so the bearer-forwarding callback below can read the caller's own incoming token —
// Catalog/Inventory validate that same token themselves, same reasoning as Scan Gateway.
builder.Services.AddHttpContextAccessor();

// gRPC needs HTTP/2, so unlike REST's "https+http://" (try https, fall back to http), this
// must commit to a single scheme up front — GrpcChannel inspects the URI scheme itself to
// pick a resolver and doesn't understand the compound one. Service discovery still resolves
// "catalog-api" to a real address underneath, via the same HttpClientFactory pipeline
// AddGrpcClient is built on. Per step 7 of the build order: "one consistent internal-call
// pattern" for all internal service-to-service calls.
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

builder.Services
    .AddGraphQLServer()
    .AddAuthorization() // enables [Authorize] on Query resolvers below
    .AddQueryType<Query>();

builder.Services.AddInventorySystemCors(builder.Configuration);

var app = builder.Build();

app.MapDefaultEndpoints();

app.UseInventorySystemCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGraphQL();

app.Run();
