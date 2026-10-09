using System.Globalization;
using global::Grpc.Core;
using InventorySystem.Auth.Contracts;
using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Services;
using InventorySystem.Grpc.Contracts.Catalog;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Grpc;

// Class-level floor for every RPC; CreateCategory/ListCategories add a stricter Admin-only
// policy on top (attributes combine with AND) — categories are admin-managed setup data, not
// a day-to-day seller action (see architecture.md), matching Scan Gateway's /categories.
[Authorize(Policy = AuthPolicies.SellerOrAdmin)]
public class CatalogGrpcServiceImpl(CatalogDbContext db, ItemCreationService itemCreation) : CatalogGrpcService.CatalogGrpcServiceBase
{
    public override async Task<ItemReply> GetItemByBarcode(GetItemByBarcodeRequest request, ServerCallContext context)
    {
        var item = await db.Items.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Barcode == request.Barcode, context.CancellationToken);

        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item found for barcode '{request.Barcode}'."));

        return ToReply(item);
    }

    public override async Task<ItemReply> GetItemBySku(GetItemBySkuRequest request, ServerCallContext context)
    {
        var item = await db.Items.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Sku == request.Sku, context.CancellationToken);

        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item found for SKU '{request.Sku}'."));

        return ToReply(item);
    }

    public override async Task<ListItemsReply> ListItems(ListItemsRequest request, ServerCallContext context)
    {
        var items = await db.Items.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListItemsReply();
        reply.Items.AddRange(items.Select(ToReply));
        return reply;
    }

    // Admin-only, matching Scan Gateway's /items/intake — creating an item also stocks it.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ItemReply> CreateItem(CreateItemRequest request, ServerCallContext context)
    {
        try
        {
            var item = await itemCreation.CreateItemAsync(
                RequireName(request.Name),
                ParsePrice(request.Price),
                request.HasBarcode ? request.Barcode : null,
                request.HasSku ? request.Sku : null,
                request.HasCategoryId ? ParseCategoryId(request.CategoryId) : null,
                request.HasImageUrl ? request.ImageUrl : null,
                context.CancellationToken);

            return ToReply(item);
        }
        catch (ItemAlreadyExistsException ex)
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, ex.Message));
        }
    }

    // A full replace of the editable fields (see UpdateItemRequest), admin-only like the rest of
    // catalog management (categories, discounts, creating items).
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ItemReply> UpdateItem(UpdateItemRequest request, ServerCallContext context)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Sku == request.Sku, context.CancellationToken);
        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item found for SKU '{request.Sku}'."));

        item.Name = RequireName(request.Name);
        item.Price = ParsePrice(request.Price);
        item.Barcode = request.Barcode;
        item.CategoryId = request.HasCategoryId ? ParseCategoryId(request.CategoryId) : null;
        item.ImageUrl = request.HasImageUrl ? request.ImageUrl : null;

        try
        {
            await db.SaveChangesAsync(context.CancellationToken);
        }
        catch (DbUpdateException ex) when (ItemCreationService.IsUniqueViolation(ex))
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Another item already uses barcode '{request.Barcode}'."));
        }

        return ToReply(item);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<CategoryReply> CreateCategory(CreateCategoryRequest request, ServerCallContext context)
    {
        if (await db.Categories.AnyAsync(c => c.Name == request.Name, context.CancellationToken))
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Category '{request.Name}' already exists."));

        var category = new Category { Id = Guid.NewGuid(), Name = request.Name };
        db.Categories.Add(category);
        await db.SaveChangesAsync(context.CancellationToken);

        return ToReply(category);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ListCategoriesReply> ListCategories(ListCategoriesRequest request, ServerCallContext context)
    {
        var categories = await db.Categories.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListCategoriesReply();
        reply.Categories.AddRange(categories.Select(ToReply));
        return reply;
    }

    // Admin-only, same reasoning as categories: a batch price reduction for a "low prices
    // period" sale is admin-managed setup, not a day-to-day seller action.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DiscountReply> ApplyDiscount(ApplyDiscountRequest request, ServerCallContext context)
    {
        if (request.Percentage <= 0 || request.Percentage >= 1)
            throw new RpcException(new Status(StatusCode.InvalidArgument, "percentage must be strictly between 0 and 1."));

        var items = await LoadItemsOrThrowAsync(request.Skus, context.CancellationToken);

        foreach (var item in items)
            item.DiscountPercentage = request.Percentage;

        await db.SaveChangesAsync(context.CancellationToken);

        var reply = new DiscountReply();
        reply.Items.AddRange(items.Select(ToReply));
        return reply;
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DiscountReply> RemoveDiscount(RemoveDiscountRequest request, ServerCallContext context)
    {
        var items = await LoadItemsOrThrowAsync(request.Skus, context.CancellationToken);

        foreach (var item in items)
            item.DiscountPercentage = null;

        await db.SaveChangesAsync(context.CancellationToken);

        var reply = new DiscountReply();
        reply.Items.AddRange(items.Select(ToReply));
        return reply;
    }

    // Shared by ApplyDiscount/RemoveDiscount: both are all-or-nothing over the requested SKU
    // list — a typo'd SKU fails the whole call instead of silently discounting a subset.
    private async Task<List<Item>> LoadItemsOrThrowAsync(IReadOnlyCollection<string> skus, CancellationToken cancellationToken)
    {
        var items = await db.Items.Where(i => skus.Contains(i.Sku)).ToListAsync(cancellationToken);

        var missing = skus.Except(items.Select(i => i.Sku)).ToList();
        if (missing.Count > 0)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item(s) found for SKU(s): {string.Join(", ", missing)}"));

        return items;
    }

    // Shared by CreateItem/UpdateItem: malformed input is the caller's mistake, so it comes back
    // as InvalidArgument rather than an unhandled FormatException (a generic Internal error).
    private static string RequireName(string name) =>
        string.IsNullOrWhiteSpace(name)
            ? throw new RpcException(new Status(StatusCode.InvalidArgument, "name is required."))
            : name;

    private static decimal ParsePrice(string value) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var price) && price >= 0
            ? price
            : throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{value}' is not a valid price."));

    private static Guid ParseCategoryId(string value) =>
        Guid.TryParse(value, out var id)
            ? id
            : throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{value}' is not a valid category id."));

    private static CategoryReply ToReply(Category category) =>
        new() { Id = category.Id.ToString(), Name = category.Name };

    private static ItemReply ToReply(Item item)
    {
        // Rounded to cents: this is what a seller charges and what a sale records as its unit
        // price, so 9.99 at 15% off must be 8.49, not 8.4915.
        var effectivePrice = item.DiscountPercentage is { } discount
            ? decimal.Round(item.Price * (1 - (decimal)discount), 2, MidpointRounding.AwayFromZero)
            : item.Price;

        var reply = new ItemReply
        {
            Sku = item.Sku,
            Name = item.Name,
            Barcode = item.Barcode,
            Price = item.Price.ToString(CultureInfo.InvariantCulture),
            EffectivePrice = effectivePrice.ToString(CultureInfo.InvariantCulture)
        };

        if (item.CategoryId is { } categoryId)
            reply.CategoryId = categoryId.ToString();

        if (item.ImageUrl is not null)
            reply.ImageUrl = item.ImageUrl;

        if (item.DiscountPercentage is { } percentage)
            reply.DiscountPercentage = percentage;

        return reply;
    }
}
