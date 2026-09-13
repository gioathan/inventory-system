using Aspire.Hosting;
using Aspire.Hosting.Testing;
using global::Grpc.Net.Client;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.Grpc.Contracts.Inventory;

namespace InventorySystem.IntegrationTests.TestHelpers;

// Catalog.Api and Inventory.Api are gRPC-only now — REST duplicates of what Scan
// Gateway/Dashboard already reached internally were removed. Tests that need to seed or
// exercise those services directly (bypassing Scan Gateway) go through gRPC too, reusing
// Aspire's own service-discovery-resolved HttpClient as the channel's transport.
public static class GrpcTestClients
{
    public static CatalogGrpcService.CatalogGrpcServiceClient CreateCatalogGrpcClient(this DistributedApplication app)
    {
        var httpClient = app.CreateHttpClient("catalog-api");
        var channel = GrpcChannel.ForAddress(httpClient.BaseAddress!, new GrpcChannelOptions { HttpClient = httpClient });
        return new CatalogGrpcService.CatalogGrpcServiceClient(channel);
    }

    public static InventoryGrpcService.InventoryGrpcServiceClient CreateInventoryGrpcClient(this DistributedApplication app)
    {
        var httpClient = app.CreateHttpClient("inventory-api");
        var channel = GrpcChannel.ForAddress(httpClient.BaseAddress!, new GrpcChannelOptions { HttpClient = httpClient });
        return new InventoryGrpcService.InventoryGrpcServiceClient(channel);
    }
}
