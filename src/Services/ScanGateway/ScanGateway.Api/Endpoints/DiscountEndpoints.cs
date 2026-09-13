using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class DiscountEndpoints
{
    public static void MapDiscountEndpoints(this WebApplication app)
    {
        // Applies one percentage to many SKUs at once (e.g. 20% off 10 items for a low-price
        // period), never touching Item.Price itself — see CatalogGrpcServiceImpl.ApplyDiscount.
        app.MapPost("/items/discount", async (ApplyDiscountRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            if (request.Skus.Count == 0)
                return Results.BadRequest("At least one SKU is required.");

            if (request.Percentage <= 0 || request.Percentage >= 1)
                return Results.BadRequest("Percentage must be strictly between 0 and 1.");

            try
            {
                var items = await catalog.ApplyDiscountAsync(request.Skus, request.Percentage, cancellationToken);
                return Results.Ok(items.Select(ToResponse));
            }
            catch (CatalogItemsNotFoundException ex)
            {
                return Results.NotFound(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly);

        // Reverts the affected SKUs back to their plain Price — end of the "low prices period."
        app.MapPost("/items/discount/remove", async (RemoveDiscountRequest request, CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            if (request.Skus.Count == 0)
                return Results.BadRequest("At least one SKU is required.");

            try
            {
                var items = await catalog.RemoveDiscountAsync(request.Skus, cancellationToken);
                return Results.Ok(items.Select(ToResponse));
            }
            catch (CatalogItemsNotFoundException ex)
            {
                return Results.NotFound(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly);
    }

    private static ItemPriceResponse ToResponse(CatalogItem item) =>
        new(item.Sku, item.Price, item.DiscountPercentage, item.EffectivePrice);
}

public record ApplyDiscountRequest(List<string> Skus, double Percentage);
public record RemoveDiscountRequest(List<string> Skus);
public record ItemPriceResponse(string Sku, decimal Price, double? DiscountPercentage, decimal EffectivePrice);
