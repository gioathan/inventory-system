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

    public override async Task<ListItemsReply> ListItems(ListItemsRequest request, ServerCallContext context)
    {
        var items = await db.Items.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListItemsReply();
        reply.Items.AddRange(items.Select(ToReply));
        return reply;
    }

    public override async Task<ItemReply> CreateItem(CreateItemRequest request, ServerCallContext context)
    {
        try
        {
            var item = await itemCreation.CreateItemAsync(
                request.Name,
                decimal.Parse(request.Price, CultureInfo.InvariantCulture),
                request.HasBarcode ? request.Barcode : null,
                request.HasSku ? request.Sku : null,
                request.HasCategoryId ? Guid.Parse(request.CategoryId) : null,
                request.HasImageUrl ? request.ImageUrl : null,
                context.CancellationToken);

            return ToReply(item);
        }
        catch (ItemAlreadyExistsException ex)
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, ex.Message));
        }
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

    private static CategoryReply ToReply(Category category) =>
        new() { Id = category.Id.ToString(), Name = category.Name };

    private static ItemReply ToReply(Item item)
    {
        var effectivePrice = item.DiscountPercentage is { } discount
            ? item.Price * (1 - (decimal)discount)
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
