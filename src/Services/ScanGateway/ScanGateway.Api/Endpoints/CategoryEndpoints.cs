using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class CategoryEndpoints
{
    public static void MapCategoryEndpoints(this WebApplication app)
    {
        // ParentId omitted creates a top-level category; given, a sub-category of that one.
        // Catalog owns the tree's rules (unique names, nesting limit) — a refusal comes back as
        // its own message.
        app.MapPost("/categories", async (CreateCategoryRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Name is required.");

            try
            {
                var category = await catalog.CreateCategoryAsync(request.Name.Trim(), request.ParentId, cancellationToken);
                return Results.Created($"/categories/{category.Id}", ToResponse(category));
            }
            catch (CategoryAlreadyExistsException ex)
            {
                return Results.Conflict(ex.Message);
            }
            catch (CatalogRuleException ex)
            {
                return Results.BadRequest(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly);

        // The whole tree as a flat list (each entry names its parent); the client assembles it.
        // Open to sellers too: the Stock screen filters by category. Changing categories stays
        // admin-only.
        app.MapGet("/categories", async (CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            var categories = await catalog.GetAllCategoriesAsync(cancellationToken);
            return Results.Ok(categories.Select(ToResponse));
        }).RequireAuthorization(AuthPolicies.SellerOrAdmin);

        // Rename, move (ParentId null = make it top-level) and delete. Catalog owns the rules —
        // unique names, no loops, the nesting limit, "only an empty category can be deleted" —
        // and its refusal comes back as its own message.
        app.MapPost("/categories/{id:guid}/rename", (Guid id, RenameCategoryRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            string.IsNullOrWhiteSpace(request.Name)
                ? Task.FromResult(Results.BadRequest("Name is required."))
                : RunAsync(async () => Results.Ok(ToResponse(await catalog.RenameCategoryAsync(id, request.Name.Trim(), cancellationToken)))))
            .RequireAuthorization(AuthPolicies.AdminOnly);

        app.MapPost("/categories/{id:guid}/move", (Guid id, MoveCategoryRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            RunAsync(async () => Results.Ok(ToResponse(await catalog.MoveCategoryAsync(id, request.ParentId, cancellationToken)))))
            .RequireAuthorization(AuthPolicies.AdminOnly);

        app.MapDelete("/categories/{id:guid}", (Guid id, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            RunAsync(async () =>
            {
                await catalog.DeleteCategoryAsync(id, cancellationToken);
                return Results.NoContent();
            }))
            .RequireAuthorization(AuthPolicies.AdminOnly);

        // Files many items under one category at once (CategoryId null clears it) — how a
        // category's items get sorted into its sub-categories. All-or-nothing.
        app.MapPost("/items/category", async (MoveItemsRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            if (request.Skus is null || request.Skus.Count == 0)
                return Results.BadRequest("At least one SKU is required.");
            if (request.Skus.Count > MaxMoveSkus)
                return Results.BadRequest($"At most {MaxMoveSkus} items can be moved at once.");

            try
            {
                var items = await catalog.MoveItemsToCategoryAsync(request.Skus, request.CategoryId, cancellationToken);
                return Results.Ok(new MoveItemsResponse(items.Count));
            }
            catch (CatalogItemsNotFoundException ex)
            {
                return Results.NotFound(ex.Message);
            }
            catch (CatalogRuleException ex)
            {
                return Results.BadRequest(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly);
    }

    private static async Task<IResult> RunAsync(Func<Task<IResult>> action)
    {
        try
        {
            return await action();
        }
        catch (CategoryNotFoundException ex)
        {
            return Results.NotFound(ex.Message);
        }
        catch (CategoryAlreadyExistsException ex)
        {
            return Results.Conflict(ex.Message);
        }
        catch (CatalogRuleException ex)
        {
            return Results.BadRequest(ex.Message);
        }
    }

    private const int MaxMoveSkus = 1000;

    private static CategoryResponse ToResponse(Category category) => new(category.Id, category.Name, category.ParentId);
}

public record CreateCategoryRequest(string Name, Guid? ParentId = null);
public record CategoryResponse(Guid Id, string Name, Guid? ParentId);
public record RenameCategoryRequest(string Name);
public record MoveCategoryRequest(Guid? ParentId);
public record MoveItemsRequest(List<string> Skus, Guid? CategoryId);
public record MoveItemsResponse(int Moved);
