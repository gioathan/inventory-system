using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class CategoryEndpoints
{
    public static void MapCategoryEndpoints(this WebApplication app)
    {
        app.MapPost("/categories", async (CreateCategoryRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            try
            {
                var category = await catalog.CreateCategoryAsync(request.Name, cancellationToken);
                return Results.Created($"/categories/{category.Id}", new CategoryResponse(category.Id, category.Name));
            }
            catch (CategoryAlreadyExistsException ex)
            {
                return Results.Conflict(ex.Message);
            }
        });

        // Needed to pick a categoryId before creating an item via /items/intake — there'd
        // otherwise be no way to see what categories exist through the seller-facing surface.
        app.MapGet("/categories", async (CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            var categories = await catalog.GetAllCategoriesAsync(cancellationToken);
            return Results.Ok(categories.Select(c => new CategoryResponse(c.Id, c.Name)));
        });
    }
}

public record CreateCategoryRequest(string Name);
public record CategoryResponse(Guid Id, string Name);
