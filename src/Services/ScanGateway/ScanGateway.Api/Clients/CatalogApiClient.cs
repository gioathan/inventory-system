using System.Globalization;
using System.Text.Json;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using Microsoft.Extensions.Caching.Distributed;

namespace InventorySystem.ScanGateway.Api.Clients;

public class CatalogApiClient(CatalogGrpcService.CatalogGrpcServiceClient grpcClient, IDistributedCache cache, IConfiguration configuration)
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
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeToCache() },
            cancellationToken);

        return item;
    }

    // The usual TTL, cut short so no entry outlives the shop's calendar day: a cached item carries
    // today's price, and a dated discount starts or ends exactly at midnight there.
    private TimeSpan TimeToCache()
    {
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(configuration["Shop:TimeZone"] ?? "Europe/Athens");
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            zone = TimeZoneInfo.Utc;
        }
        var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);
        var untilMidnight = now.Date.AddDays(1) - now.DateTime;
        return untilMidnight < CacheTtl ? (untilMidnight > TimeSpan.FromSeconds(1) ? untilMidnight : TimeSpan.FromSeconds(1)) : CacheTtl;
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
        catch (RpcException ex) when (IsRuleViolation(ex))
        {
            throw new CatalogRuleException(ex.Status.Detail);
        }
    }

    // Catalog refusing the request on its own rules (a category that doesn't exist or that has
    // sub-categories, a nesting limit) — the caller's to fix, so endpoints answer 400 with
    // Catalog's message rather than letting it surface as a 500.
    private static bool IsRuleViolation(RpcException ex) =>
        ex.StatusCode is StatusCode.InvalidArgument or StatusCode.FailedPrecondition;

    // A full replace of the editable fields; Sku is the lookup key and never itself changes (see
    // UpdateItemRequest in catalog.proto for why). Reads the item's current barcode first so its
    // cache entry can be dropped after the write — needed whether or not the edit changes the
    // barcode itself: unchanged, that entry still holds the old name/price/image; changed, it
    // would otherwise keep resolving the old barcode to this item until the entry's TTL expired.
    public async Task<CatalogItem> UpdateItemAsync(
        string sku, string name, decimal price, string barcode, Guid? categoryId, string? imageUrl, CancellationToken cancellationToken)
    {
        ItemReply before;
        try
        {
            before = await grpcClient.GetItemBySkuAsync(new GetItemBySkuRequest { Sku = sku }, cancellationToken: cancellationToken);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CatalogItemsNotFoundException(ex.Status.Detail);
        }

        var request = new UpdateItemRequest
        {
            Sku = sku,
            Name = name,
            Price = price.ToString(CultureInfo.InvariantCulture),
            Barcode = barcode
        };

        if (categoryId is { } id)
            request.CategoryId = id.ToString();
        if (imageUrl is not null)
            request.ImageUrl = imageUrl;

        ItemReply reply;
        try
        {
            reply = await grpcClient.UpdateItemAsync(request, cancellationToken: cancellationToken);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CatalogItemsNotFoundException(ex.Status.Detail);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.AlreadyExists)
        {
            throw new ItemAlreadyExistsException(ex.Status.Detail);
        }
        catch (RpcException ex) when (IsRuleViolation(ex))
        {
            throw new CatalogRuleException(ex.Status.Detail);
        }

        await cache.RemoveAsync($"catalog-item:{before.Barcode}", cancellationToken);
        return ToCatalogItem(reply);
    }

    public async Task<Category> CreateCategoryAsync(string name, Guid? parentId, CancellationToken cancellationToken)
    {
        var request = new CreateCategoryRequest { Name = name };
        if (parentId is { } id)
            request.ParentId = id.ToString();

        try
        {
            return ToCategory(await grpcClient.CreateCategoryAsync(request, cancellationToken: cancellationToken));
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.AlreadyExists)
        {
            throw new CategoryAlreadyExistsException(name);
        }
        catch (RpcException ex) when (IsRuleViolation(ex))
        {
            throw new CatalogRuleException(ex.Status.Detail);
        }
    }

    // Sorting items into a category in one go (null clears it). Each moved item's cached
    // barcode lookup is dropped, same as after a discount: the entry carries the category.
    public async Task<List<CatalogItem>> MoveItemsToCategoryAsync(IEnumerable<string> skus, Guid? categoryId, CancellationToken cancellationToken)
    {
        var request = new MoveItemsToCategoryRequest();
        request.Skus.AddRange(skus);
        if (categoryId is { } id)
            request.CategoryId = id.ToString();

        MoveItemsToCategoryReply reply;
        try
        {
            reply = await grpcClient.MoveItemsToCategoryAsync(request, cancellationToken: cancellationToken);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CatalogItemsNotFoundException(ex.Status.Detail);
        }
        catch (RpcException ex) when (IsRuleViolation(ex))
        {
            throw new CatalogRuleException(ex.Status.Detail);
        }

        var items = reply.Items.Select(ToCatalogItem).ToList();
        await InvalidateCacheAsync(items, cancellationToken);
        return items;
    }

    public Task<Category> RenameCategoryAsync(Guid id, string name, CancellationToken cancellationToken) =>
        ChangeCategoryAsync(name, async () => ToCategory(await grpcClient.RenameCategoryAsync(
            new RenameCategoryRequest { Id = id.ToString(), Name = name }, cancellationToken: cancellationToken)));

    public Task<Category> MoveCategoryAsync(Guid id, Guid? parentId, CancellationToken cancellationToken)
    {
        var request = new MoveCategoryRequest { Id = id.ToString() };
        if (parentId is { } parent)
            request.ParentId = parent.ToString();
        return ChangeCategoryAsync(null, async () => ToCategory(await grpcClient.MoveCategoryAsync(request, cancellationToken: cancellationToken)));
    }

    public Task DeleteCategoryAsync(Guid id, CancellationToken cancellationToken) =>
        ChangeCategoryAsync<object?>(null, async () =>
        {
            await grpcClient.DeleteCategoryAsync(new DeleteCategoryRequest { Id = id.ToString() }, cancellationToken: cancellationToken);
            return null;
        });

    // One translation of Catalog's answers for the three category edits, so each endpoint maps
    // the same exceptions the same way.
    private static async Task<T> ChangeCategoryAsync<T>(string? name, Func<Task<T>> call)
    {
        try
        {
            return await call();
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CategoryNotFoundException(ex.Status.Detail);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.AlreadyExists)
        {
            throw new CategoryAlreadyExistsException(name ?? "");
        }
        catch (RpcException ex) when (IsRuleViolation(ex))
        {
            throw new CatalogRuleException(ex.Status.Detail);
        }
    }

    // ---- dated discounts ----

    public async Task<List<DatedDiscount>> GetDatedDiscountsAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListDatedDiscountsAsync(new ListDatedDiscountsRequest(), cancellationToken: cancellationToken);
        return reply.DatedDiscounts.Select(ToDatedDiscount).ToList();
    }

    // id null creates; otherwise replaces that one whole. Either way the cached lookups of every
    // item it touches (before or after the change) are dropped — if it's running today, their
    // price just changed.
    public async Task<DatedDiscount> SaveDatedDiscountAsync(
        Guid? id, string name, double percentage, IEnumerable<(string Start, string End)> periods, IReadOnlyCollection<string> skus, CancellationToken cancellationToken)
    {
        var before = id is null ? [] : await SkusOfAsync(id.Value, cancellationToken);

        var request = new SaveDatedDiscountRequest { Name = name, Percentage = percentage };
        if (id is { } existing)
            request.Id = existing.ToString();
        request.Periods.AddRange(periods.Select(p => new DatedDiscountPeriodMessage { StartDate = p.Start, EndDate = p.End }));
        request.Skus.AddRange(skus);

        var saved = await ChangeDatedDiscountAsync(async () => ToDatedDiscount(await grpcClient.SaveDatedDiscountAsync(request, cancellationToken: cancellationToken)));
        await InvalidateSkusAsync(before.Concat(saved.Skus), cancellationToken);
        return saved;
    }

    public async Task<DatedDiscount> SetDatedDiscountSkipAsync(Guid id, bool skip, CancellationToken cancellationToken)
    {
        var updated = await ChangeDatedDiscountAsync(async () => ToDatedDiscount(await grpcClient.SetDatedDiscountSkipAsync(
            new SetDatedDiscountSkipRequest { Id = id.ToString(), Skip = skip }, cancellationToken: cancellationToken)));
        await InvalidateSkusAsync(updated.Skus, cancellationToken);
        return updated;
    }

    public async Task DeleteDatedDiscountAsync(Guid id, CancellationToken cancellationToken)
    {
        var before = await SkusOfAsync(id, cancellationToken);
        await ChangeDatedDiscountAsync<object?>(async () =>
        {
            await grpcClient.DeleteDatedDiscountAsync(new DeleteDatedDiscountRequest { Id = id.ToString() }, cancellationToken: cancellationToken);
            return null;
        });
        await InvalidateSkusAsync(before, cancellationToken);
    }

    private async Task<List<string>> SkusOfAsync(Guid id, CancellationToken cancellationToken) =>
        (await GetDatedDiscountsAsync(cancellationToken)).FirstOrDefault(d => d.Id == id)?.Skus ?? [];

    // The barcode cache is keyed by barcode, so the SKUs are mapped through the item list first.
    private async Task InvalidateSkusAsync(IEnumerable<string> skus, CancellationToken cancellationToken)
    {
        var wanted = skus.ToHashSet(StringComparer.Ordinal);
        if (wanted.Count == 0)
            return;
        await InvalidateCacheAsync((await GetAllItemsAsync(cancellationToken)).Where(i => wanted.Contains(i.Sku)), cancellationToken);
    }

    private static async Task<T> ChangeDatedDiscountAsync<T>(Func<Task<T>> call)
    {
        try
        {
            return await call();
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            throw new CatalogItemsNotFoundException(ex.Status.Detail);
        }
        catch (RpcException ex) when (IsRuleViolation(ex))
        {
            throw new CatalogRuleException(ex.Status.Detail);
        }
    }

    private static DatedDiscount ToDatedDiscount(DatedDiscountReply reply) => new(
        Guid.Parse(reply.Id),
        reply.Name,
        reply.Percentage,
        reply.Periods.Select(p => new DatedDiscountPeriod(p.StartDate, p.EndDate)).ToList(),
        reply.Skus.ToList(),
        reply.ActiveToday,
        reply.HasNextStart ? reply.NextStart : null,
        reply.HasNextEnd ? reply.NextEnd : null,
        reply.HasDaysUntilNext ? reply.DaysUntilNext : null,
        reply.HasLastStart ? reply.LastStart : null,
        reply.HasLastEnd ? reply.LastEnd : null,
        reply.HasSkippedYear ? reply.SkippedYear : null);

    private static Category ToCategory(CategoryReply reply) =>
        new(Guid.Parse(reply.Id), reply.Name, reply.HasParentId ? Guid.Parse(reply.ParentId) : null);

    public async Task<List<CatalogItem>> GetAllItemsAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListItemsAsync(new ListItemsRequest(), cancellationToken: cancellationToken);
        return reply.Items.Select(ToCatalogItem).ToList();
    }

    public async Task<List<Category>> GetAllCategoriesAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListCategoriesAsync(new ListCategoriesRequest(), cancellationToken: cancellationToken);
        return reply.Categories.Select(ToCategory).ToList();
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
        decimal.Parse(reply.EffectivePrice, CultureInfo.InvariantCulture),
        reply.HasActiveDiscountPercentage ? reply.ActiveDiscountPercentage : null,
        reply.HasDatedDiscountName ? reply.DatedDiscountName : null);
}

public record CatalogItem(
    string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId,
    double? DiscountPercentage, decimal EffectivePrice,
    // What is setting EffectivePrice today — the manual discount or a dated one, whichever is
    // bigger — and the dated discount's name when that is the one. Defaulted so entries cached
    // before these existed still deserialize.
    double? ActiveDiscountPercentage = null, string? DatedDiscountName = null);
public record DatedDiscountPeriod(string StartDate, string EndDate);
public record DatedDiscount(
    Guid Id, string Name, double Percentage, List<DatedDiscountPeriod> Periods, List<string> Skus,
    bool ActiveToday, string? NextStart, string? NextEnd, int? DaysUntilNext, string? LastStart, string? LastEnd, int? SkippedYear);
public record Category(Guid Id, string Name, Guid? ParentId);

public class CategoryAlreadyExistsException(string name) : Exception($"Category '{name}' already exists.");
public class ItemAlreadyExistsException(string message) : Exception(message);
public class CatalogRuleException(string message) : Exception(message);
public class CategoryNotFoundException(string message) : Exception(message);
public class CatalogItemsNotFoundException(string message) : Exception(message);
