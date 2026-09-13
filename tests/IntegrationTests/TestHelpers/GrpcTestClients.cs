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
        var httpClient = CreateGrpcCompatibleHttpClient(app, "catalog-api");
        var channel = GrpcChannel.ForAddress(httpClient.BaseAddress!, new GrpcChannelOptions { HttpClient = httpClient });
        return new CatalogGrpcService.CatalogGrpcServiceClient(channel);
    }

    public static InventoryGrpcService.InventoryGrpcServiceClient CreateInventoryGrpcClient(this DistributedApplication app)
    {
        var httpClient = CreateGrpcCompatibleHttpClient(app, "inventory-api");
        var channel = GrpcChannel.ForAddress(httpClient.BaseAddress!, new GrpcChannelOptions { HttpClient = httpClient });
        return new InventoryGrpcService.InventoryGrpcServiceClient(channel);
    }

    // app.CreateHttpClient(...) returns a generic HttpClient, which defaults to requesting
    // HTTP/1.1 — incompatible with gRPC's hard HTTP/2 requirement. Handing that default client
    // straight to GrpcChannelOptions doesn't fail cleanly, it hangs until the caller's own
    // timeout fires. Forcing the request version here is what production gRPC clients
    // (AddGrpcClient) do automatically; a bare HttpClient needs it set explicitly.
    private static HttpClient CreateGrpcCompatibleHttpClient(DistributedApplication app, string resourceName)
    {
        var client = app.CreateHttpClient(resourceName);
        client.DefaultRequestVersion = System.Net.HttpVersion.Version20;
        client.DefaultVersionPolicy = System.Net.Http.HttpVersionPolicy.RequestVersionExact;
        return client;
    }
}
