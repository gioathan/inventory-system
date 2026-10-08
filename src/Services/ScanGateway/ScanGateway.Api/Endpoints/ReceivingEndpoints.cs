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

        // A whole delivery in one request: many existing items, each with its own quantity.
        // Deliberately NOT all-or-nothing — every line gets its own outcome and a 200 comes back
        // even if some failed, so one unknown SKU can't block the other ninety-nine lines of a
        // delivery that has physically arrived. The caller retries only the lines that failed;
        // resending a line that already succeeded would add its stock twice.
        app.MapPost("/receive/batch", async (
            BatchReceiveRequest request,
            CatalogApiClient catalog,
            InventoryApiClient inventory,
            CancellationToken cancellationToken) =>
        {
            if (request.Lines is null || request.Lines.Count == 0)
                return Results.BadRequest("Add at least one line.");
            if (request.Lines.Count > MaxBatchLines)
                return Results.BadRequest($"A batch can hold at most {MaxBatchLines} lines; split it into several requests.");

            // One catalog call for the whole batch instead of one lookup per line. Inventory's
            // receive is an upsert, so without this check an unknown SKU would silently create
            // stock for an item that has no name or price.
            var knownSkus = (await catalog.GetAllItemsAsync(cancellationToken)).Select(i => i.Sku).ToHashSet(StringComparer.Ordinal);

            var results = new List<BatchReceiveLineResult>(request.Lines.Count);
            foreach (var line in request.Lines)
            {
                if (line.Quantity <= 0)
                {
                    results.Add(new BatchReceiveLineResult(line.Sku, BatchReceiveStatus.Invalid, null, "Quantity must be positive."));
                    continue;
                }
                if (string.IsNullOrWhiteSpace(line.Sku) || !knownSkus.Contains(line.Sku))
                {
                    results.Add(new BatchReceiveLineResult(line.Sku, BatchReceiveStatus.NotFound, null, "No catalog item has this SKU."));
                    continue;
                }

                try
                {
                    var stock = await inventory.ReceiveStockAsync(line.Sku, line.Quantity, MovementReason.Restock, cancellationToken);
                    results.Add(new BatchReceiveLineResult(line.Sku, BatchReceiveStatus.Received, stock.QuantityOnHand, null));
                }
                catch (global::Grpc.Core.RpcException ex)
                {
                    results.Add(new BatchReceiveLineResult(line.Sku, BatchReceiveStatus.Failed, null, ex.Status.Detail));
                }
            }

            return Results.Ok(new BatchReceiveResponse(results));
        }).RequireAuthorization(AuthPolicies.SellerOrAdmin);
    }

    private const int MaxBatchLines = 500;
}

public record BatchReceiveLine(string Sku, int Quantity);
public record BatchReceiveRequest(List<BatchReceiveLine> Lines);
public record BatchReceiveLineResult(string Sku, string Status, int? QuantityOnHand, string? Error);
public record BatchReceiveResponse(List<BatchReceiveLineResult> Results);

public static class BatchReceiveStatus
{
    public const string Received = "received";
    public const string NotFound = "notFound";
    public const string Invalid = "invalid";
    public const string Failed = "failed";
}

public record IntakeNewItemRequest(string Name, decimal Price, Guid? CategoryId, string? ImageUrl, int Quantity, string? Barcode = null);
public record RestockRequest(int Quantity);
public record ReceiveResponse(string Sku, string Name, string Barcode, decimal Price, int QuantityOnHand);
