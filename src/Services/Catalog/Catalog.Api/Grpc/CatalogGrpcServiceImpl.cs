using System.Globalization;
using global::Grpc.Core;
using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Services;
using InventorySystem.Grpc.Contracts.Catalog;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Grpc;

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

    public override async Task<CategoryReply> CreateCategory(CreateCategoryRequest request, ServerCallContext context)
    {
        if (await db.Categories.AnyAsync(c => c.Name == request.Name, context.CancellationToken))
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Category '{request.Name}' already exists."));

        var category = new Category { Id = Guid.NewGuid(), Name = request.Name };
        db.Categories.Add(category);
        await db.SaveChangesAsync(context.CancellationToken);

        return ToReply(category);
    }

    public override async Task<ListCategoriesReply> ListCategories(ListCategoriesRequest request, ServerCallContext context)
    {
        var categories = await db.Categories.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListCategoriesReply();
        reply.Categories.AddRange(categories.Select(ToReply));
        return reply;
    }

    private static CategoryReply ToReply(Category category) =>
        new() { Id = category.Id.ToString(), Name = category.Name };

    private static ItemReply ToReply(Item item)
    {
        var reply = new ItemReply
        {
            Sku = item.Sku,
            Name = item.Name,
            Barcode = item.Barcode,
            Price = item.Price.ToString(CultureInfo.InvariantCulture)
        };

        if (item.CategoryId is { } categoryId)
            reply.CategoryId = categoryId.ToString();

        if (item.ImageUrl is not null)
            reply.ImageUrl = item.ImageUrl;

        return reply;
    }
}
