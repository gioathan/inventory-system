using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class ScanEndpoints
{
    public static void MapScanEndpoints(this WebApplication app)
    {
        app.MapGet("/scan/{barcode}", async (
            string barcode,
            CatalogApiClient catalog,
            InventoryApiClient inventory,
            CancellationToken cancellationToken) =>
        {
            var item = await catalog.GetItemByBarcodeAsync(barcode, cancellationToken);
            if (item is null)
                return Results.NotFound($"No catalog item found for barcode '{barcode}'.");

            // A catalog item can exist before it has ever been stocked, so "no stock record
            // yet" isn't an error here — QuantityOnHand is nullable to represent that.
            var stock = await inventory.GetStockAsync(item.Sku, cancellationToken);

            return Results.Ok(new ScanResponse(item.Sku, item.Name, item.Barcode, item.Price, stock?.QuantityOnHand));
        });

        // The confirm step of the scan-and-sell UX: GET /scan/{barcode} above is always a pure
        // lookup (safe to call just to check quantity); this is the only thing that actually
        // reduces stock, and only fires when a seller explicitly picks a quantity and confirms.
        app.MapPost("/scan/{barcode}/sell", async (
            string barcode,
            SellRequest request,
            CatalogApiClient catalog,
            InventoryApiClient inventory,
            CancellationToken cancellationToken) =>
        {
            if (request.Quantity <= 0)
                return Results.BadRequest("Quantity must be positive.");

            var item = await catalog.GetItemByBarcodeAsync(barcode, cancellationToken);
            if (item is null)
                return Results.NotFound($"No catalog item found for barcode '{barcode}'.");

            var result = await inventory.SellStockAsync(item.Sku, request.Quantity, cancellationToken);

            return result.Outcome switch
            {
                SellOutcome.NotFound => Results.NotFound($"'{item.Sku}' has never been stocked."),
                SellOutcome.InsufficientStock => Results.Conflict($"Insufficient stock for '{item.Sku}'."),
                _ => Results.Ok(new ScanResponse(item.Sku, item.Name, item.Barcode, item.Price, result.Stock!.QuantityOnHand))
            };
        });
    }
}

public record ScanResponse(string Sku, string Name, string Barcode, decimal Price, int? QuantityOnHand);
public record SellRequest(int Quantity = 1);
