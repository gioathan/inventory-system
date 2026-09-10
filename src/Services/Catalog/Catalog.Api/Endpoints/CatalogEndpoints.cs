using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Endpoints;

public static class CatalogEndpoints
{
    public static void MapCatalogEndpoints(this WebApplication app)
    {
        app.MapPost("/categories", async (CreateCategoryRequest request, CatalogDbContext db) =>
        {
            if (await db.Categories.AnyAsync(c => c.Name == request.Name))
                return Results.Conflict($"Category '{request.Name}' already exists.");

            var category = new Category { Id = Guid.NewGuid(), Name = request.Name };
            db.Categories.Add(category);
            await db.SaveChangesAsync();

            return Results.Created($"/categories/{category.Id}", new CategoryResponse(category.Id, category.Name));
        });

        app.MapGet("/categories", async (CatalogDbContext db) =>
        {
            var categories = await db.Categories.AsNoTracking()
                .Select(c => new CategoryResponse(c.Id, c.Name))
                .ToListAsync();
            return Results.Ok(categories);
        });

        // Sku/Barcode are optional here: omit them and ItemCreationService auto-generates a
        // code for both, for items that don't have a pre-existing manufacturer barcode.
        app.MapPost("/items", async (CreateItemRequest request, ItemCreationService itemCreation, CancellationToken cancellationToken) =>
        {
            try
            {
                var item = await itemCreation.CreateItemAsync(
                    request.Name, request.Price, request.Barcode, request.Sku, request.CategoryId, request.ImageUrl, cancellationToken);

                return Results.Created($"/items/by-sku/{item.Sku}", ToResponse(item));
            }
            catch (ItemAlreadyExistsException ex)
            {
                return Results.Conflict(ex.Message);
            }
        });

        app.MapGet("/items/by-sku/{sku}", async (string sku, CatalogDbContext db) =>
        {
            var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Sku == sku);
            return item is null ? Results.NotFound() : Results.Ok(ToResponse(item));
        });

        // Dashboard.Api's GraphQL resolvers call this to build the item side of the
        // composed dashboard query — no single-item lookup covers "give me everything".
        app.MapGet("/items", async (CatalogDbContext db) =>
        {
            var items = await db.Items.AsNoTracking()
                .Select(i => ToResponse(i))
                .ToListAsync();
            return Results.Ok(items);
        });

        // This is the lookup Scan Gateway will call: barcode in, item out.
        app.MapGet("/items/by-barcode/{barcode}", async (string barcode, CatalogDbContext db) =>
        {
            var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Barcode == barcode);
            return item is null ? Results.NotFound() : Results.Ok(ToResponse(item));
        });
    }

    private static ItemResponse ToResponse(Item item) =>
        new(item.Sku, item.Name, item.Barcode, item.Price, item.ImageUrl, item.CategoryId);
}

public record CreateCategoryRequest(string Name);
public record CategoryResponse(Guid Id, string Name);
public record CreateItemRequest(string Name, decimal Price, string? Barcode, string? Sku, Guid? CategoryId, string? ImageUrl);
public record ItemResponse(string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId);
