using InventorySystem.Dashboard.Api.Clients;
using InventorySystem.Dashboard.Api.GraphQL;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.Grpc.Contracts.Inventory;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// gRPC needs HTTP/2, so unlike REST's "https+http://" (try https, fall back to http), this
// must commit to a single scheme up front — GrpcChannel inspects the URI scheme itself to
// pick a resolver and doesn't understand the compound one. Service discovery still resolves
// "catalog-api" to a real address underneath, via the same HttpClientFactory pipeline
// AddGrpcClient is built on. Per step 7 of the build order: "one consistent internal-call
// pattern" for all internal service-to-service calls.
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

builder.Services
    .AddGraphQLServer()
    .AddQueryType<Query>();

var app = builder.Build();

app.MapDefaultEndpoints();

app.MapGraphQL();

app.Run();
