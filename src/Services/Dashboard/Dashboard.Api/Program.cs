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

builder.Services
    .AddGraphQLServer()
    .AddAuthorization() // enables [Authorize] on Query resolvers below
    .AddQueryType<Query>();

var app = builder.Build();

app.MapDefaultEndpoints();

app.UseAuthentication();
app.UseAuthorization();

app.MapGraphQL();

app.Run();
