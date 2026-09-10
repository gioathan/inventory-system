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
    }
}

public record ScanResponse(string Sku, string Name, string Barcode, decimal Price, int? QuantityOnHand);
