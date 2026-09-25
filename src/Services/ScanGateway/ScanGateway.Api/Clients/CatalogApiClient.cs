using System.Globalization;
using System.Text.Json;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using Microsoft.Extensions.Caching.Distributed;

namespace InventorySystem.ScanGateway.Api.Clients;

public class CatalogApiClient(CatalogGrpcService.CatalogGrpcServiceClient grpcClient, IDistributedCache cache)
{
    // Discount apply/remove explicitly invalidate the affected entries (see
    // InvalidateCacheAsync) since they change the price a cached lookup would return; this TTL
    // is just the fallback ceiling on staleness for everything else.
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

    // With no barcode, Catalog auto-generates one — the "system-generated code" path for items
    // with no pre-existing manufacturer barcode. With one, Catalog uses exactly that value (and
    // reuses it as the SKU), so goods that already carry a UPC/EAN can be registered under it.
    public async Task<CatalogItem> CreateItemAsync(
        string name, decimal price, Guid? categoryId, string? imageUrl, string? barcode, CancellationToken cancellationToken)
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
        if (barcode is not null)
            request.Barcode = barcode;

        try
        {
            var reply = await grpcClient.CreateItemAsync(request, cancellationToken: cancellationToken);
            return ToCatalogItem(reply);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.AlreadyExists)
        {
            throw new ItemAlreadyExistsException(ex.Status.Detail);
        }
    }

    public async Task<Category> CreateCategoryAsync(string name, CancellationToken cancellationToken)
    {
        try
        {
            var reply = await grpcClient.CreateCategoryAsync(new CreateCategoryRequest { Name = name }, cancellationToken: cancellationToken);
            return new Category(Guid.Parse(reply.Id), reply.Name);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.AlreadyExists)
        {
            throw new CategoryAlreadyExistsException(name);
        }
    }

    public async Task<List<Category>> GetAllCategoriesAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListCategoriesAsync(new ListCategoriesRequest(), cancellationToken: cancellationToken);
        return reply.Categories.Select(c => new Category(Guid.Parse(c.Id), c.Name)).ToList();
    }

    public async Task<List<CatalogItem>> ApplyDiscountAsync(IEnumerable<string> skus, double percentage, CancellationToken cancellationToken)
    {
        var request = new ApplyDiscountRequest { Percentage = percentage };
        request.Skus.AddRange(skus);

        DiscountReply reply;
        try
        {
            reply = await grpcClient.ApplyDiscountAsync(request, cancellationToken: cancellationToken);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CatalogItemsNotFoundException(ex.Status.Detail);
        }

        var items = reply.Items.Select(ToCatalogItem).ToList();
        await InvalidateCacheAsync(items, cancellationToken);
        return items;
    }

    public async Task<List<CatalogItem>> RemoveDiscountAsync(IEnumerable<string> skus, CancellationToken cancellationToken)
    {
        var request = new RemoveDiscountRequest();
        request.Skus.AddRange(skus);

        DiscountReply reply;
        try
        {
            reply = await grpcClient.RemoveDiscountAsync(request, cancellationToken: cancellationToken);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CatalogItemsNotFoundException(ex.Status.Detail);
        }

        var items = reply.Items.Select(ToCatalogItem).ToList();
        await InvalidateCacheAsync(items, cancellationToken);
        return items;
    }

    // Applying/removing a discount changes the price a cached barcode->item entry would
    // return, so those entries can't just be left to expire on their own TTL (up to 5 stale
    // minutes of a seller scanning the old price right after a sale starts or ends).
    private async Task InvalidateCacheAsync(IEnumerable<CatalogItem> items, CancellationToken cancellationToken)
    {
        foreach (var item in items)
            await cache.RemoveAsync($"catalog-item:{item.Barcode}", cancellationToken);
    }

    private static CatalogItem ToCatalogItem(ItemReply reply) => new(
        reply.Sku,
        reply.Name,
        reply.Barcode,
        decimal.Parse(reply.Price, CultureInfo.InvariantCulture),
        reply.HasImageUrl ? reply.ImageUrl : null,
        reply.HasCategoryId ? Guid.Parse(reply.CategoryId) : null,
        reply.HasDiscountPercentage ? reply.DiscountPercentage : null,
        decimal.Parse(reply.EffectivePrice, CultureInfo.InvariantCulture));
}

public record CatalogItem(
    string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId,
    double? DiscountPercentage, decimal EffectivePrice);
public record Category(Guid Id, string Name);

public class CategoryAlreadyExistsException(string name) : Exception($"Category '{name}' already exists.");
public class ItemAlreadyExistsException(string message) : Exception(message);
public class CatalogItemsNotFoundException(string message) : Exception(message);
