using System.Text.RegularExpressions;
using InventorySystem.Auth.Contracts;
using InventorySystem.Grpc.Contracts.Inventory;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static partial class ReceivingEndpoints
{
    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex SafeBarcode { get; }

    public static void MapReceivingEndpoints(this WebApplication app)
    {
        // New item intake. Omit Barcode and Catalog generates one (for items with no pre-existing
        // manufacturer barcode); supply one to register goods under the UPC/EAN they already
        // carry. Response includes the barcode either way.
        app.MapPost("/items/intake", async (
            IntakeNewItemRequest request,
            CatalogApiClient catalog,
            InventoryApiClient inventory,
            CancellationToken cancellationToken) =>
        {
            if (request.Quantity <= 0)
                return Results.BadRequest("Quantity must be positive.");

            // The barcode becomes part of a URL path (/scan/{barcode}), so a supplied one is held
            // to characters that can't break routing. Blank means "generate one".
            var barcode = string.IsNullOrWhiteSpace(request.Barcode) ? null : request.Barcode.Trim();
            if (barcode is not null && !SafeBarcode.IsMatch(barcode))
                return Results.BadRequest("Barcode may only contain letters, digits, '.', '_' and '-' (max 64 characters).");

            try
            {
                var item = await catalog.CreateItemAsync(request.Name, request.Price, request.CategoryId, request.ImageUrl, barcode, cancellationToken);
                var stock = await inventory.ReceiveStockAsync(item.Sku, request.Quantity, MovementReason.Intake, cancellationToken);

                return Results.Ok(new ReceiveResponse(item.Sku, item.Name, item.Barcode, item.Price, stock.QuantityOnHand));
            }
            catch (ItemAlreadyExistsException ex)
            {
                return Results.Conflict(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.SellerOrAdmin);

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

            var stock = await inventory.ReceiveStockAsync(item.Sku, request.Quantity, MovementReason.Restock, cancellationToken);

            return Results.Ok(new ReceiveResponse(item.Sku, item.Name, item.Barcode, item.Price, stock.QuantityOnHand));
        }).RequireAuthorization(AuthPolicies.SellerOrAdmin);
    }
}

public record IntakeNewItemRequest(string Name, decimal Price, Guid? CategoryId, string? ImageUrl, int Quantity, string? Barcode = null);
public record RestockRequest(int Quantity);
public record ReceiveResponse(string Sku, string Name, string Barcode, decimal Price, int QuantityOnHand);
