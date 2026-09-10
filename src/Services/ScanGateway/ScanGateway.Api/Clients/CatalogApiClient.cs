using System.Globalization;
using System.Text.Json;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using Microsoft.Extensions.Caching.Distributed;

namespace InventorySystem.ScanGateway.Api.Clients;

public class CatalogApiClient(CatalogGrpcService.CatalogGrpcServiceClient grpcClient, IDistributedCache cache)
{
    // Catalog has no update/delete endpoints yet, so there's nothing to invalidate on writes —
    // a short TTL is sufficient for now. Revisit with real invalidation once Catalog can mutate
    // existing items (see architecture.md).
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    public async Task<CatalogItem?> GetItemByBarcodeAsync(string barcode, CancellationToken cancellationToken)
    {
        var cacheKey = $"catalog-item:{barcode}";

        var cached = await cache.GetStringAsync(cacheKey, cancellationToken);
        if (cached is not null)
            return JsonSerializer.Deserialize<CatalogItem>(cached);

        ItemReply reply;
        try
        {
            reply = await grpcClient.GetItemByBarcodeAsync(
                new GetItemByBarcodeRequest { Barcode = barcode },
                cancellationToken: cancellationToken);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            return null; // misses are cheap and not cached — an item created moments later should resolve immediately
        }

        var item = ToCatalogItem(reply);

        await cache.SetStringAsync(
            cacheKey,
            JsonSerializer.Serialize(item),
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = CacheTtl },
            cancellationToken);

        return item;
    }

    // Intake never supplies a barcode/sku — Catalog always auto-generates one, which is the
    // whole point of "system-generated code" for items with no pre-existing manufacturer barcode.
    public async Task<CatalogItem> CreateItemAsync(
        string name, decimal price, Guid? categoryId, string? imageUrl, CancellationToken cancellationToken)
    {
        var request = new CreateItemRequest
        {
            Name = name,
            Price = price.ToString(CultureInfo.InvariantCulture)
        };

        if (categoryId is { } id)
            request.CategoryId = id.ToString();
        if (imageUrl is not null)
            request.ImageUrl = imageUrl;

        var reply = await grpcClient.CreateItemAsync(request, cancellationToken: cancellationToken);
        return ToCatalogItem(reply);
    }

    private static CatalogItem ToCatalogItem(ItemReply reply) => new(
        reply.Sku,
        reply.Name,
        reply.Barcode,
        decimal.Parse(reply.Price, CultureInfo.InvariantCulture),
        reply.HasImageUrl ? reply.ImageUrl : null,
        reply.HasCategoryId ? Guid.Parse(reply.CategoryId) : null);
}

public record CatalogItem(string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId);
