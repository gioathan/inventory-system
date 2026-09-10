using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class ReceivingEndpoints
{
    public static void MapReceivingEndpoints(this WebApplication app)
    {
        // New item intake: no barcode from the caller — Catalog always generates one, since
        // that's the whole point of auto-generating a code for items with no pre-existing
        // manufacturer barcode. Response includes the generated barcode.
        app.MapPost("/items/intake", async (
            IntakeNewItemRequest request,
            CatalogApiClient catalog,
            InventoryApiClient inventory,
            CancellationToken cancellationToken) =>
        {
            if (request.Quantity <= 0)
                return Results.BadRequest("Quantity must be positive.");

            var item = await catalog.CreateItemAsync(request.Name, request.Price, request.CategoryId, request.ImageUrl, cancellationToken);
            var stock = await inventory.ReceiveStockAsync(item.Sku, request.Quantity, cancellationToken);

            return Results.Ok(new ReceiveResponse(item.Sku, item.Name, item.Barcode, item.Price, stock.QuantityOnHand));
        });

        // Restock an existing item by its already-assigned barcode — the "I scanned something
        // the system already knows about" path. Unknown barcodes 404 here rather than
        // silently creating an item with no name/price; use /items/intake for that.
        app.MapPost("/scan/{barcode}/receive", async (
            string barcode,
            RestockRequest request,
            CatalogApiClient catalog,
            InventoryApiClient inventory,
            CancellationToken cancellationToken) =>
        {
            if (request.Quantity <= 0)
                return Results.BadRequest("Quantity must be positive.");

            var item = await catalog.GetItemByBarcodeAsync(barcode, cancellationToken);
            if (item is null)
                return Results.NotFound($"No catalog item found for barcode '{barcode}'. Use /items/intake to create a new item.");

            var stock = await inventory.ReceiveStockAsync(item.Sku, request.Quantity, cancellationToken);

            return Results.Ok(new ReceiveResponse(item.Sku, item.Name, item.Barcode, item.Price, stock.QuantityOnHand));
        });
    }
}

public record IntakeNewItemRequest(string Name, decimal Price, Guid? CategoryId, string? ImageUrl, int Quantity);
public record RestockRequest(int Quantity);
public record ReceiveResponse(string Sku, string Name, string Barcode, decimal Price, int QuantityOnHand);
