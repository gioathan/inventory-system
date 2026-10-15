using System.Text.RegularExpressions;
using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

// Item edits, as opposed to the item creation/receiving flow in ReceivingEndpoints. Split out
// because editing is an admin catalog-management action (like categories/discounts), not
// something a seller receiving stock needs.
public static partial class ItemsEndpoints
{
    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex SafeBarcode { get; }

    public static void MapItemsEndpoints(this WebApplication app)
    {
        // A full replace of the editable fields — Sku identifies the item and isn't itself
        // editable (see UpdateItemRequest in catalog.proto for why).
        app.MapPut("/items/{sku}", async (
            string sku,
            UpdateItemRequestBody request,
            CatalogApiClient catalog,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Name is required.");
            if (request.Price <= 0)
                return Results.BadRequest("Price must be more than 0.");

            var barcode = request.Barcode.Trim();
            if (!SafeBarcode.IsMatch(barcode))
                return Results.BadRequest("Barcode may only contain letters, digits, '.', '_' and '-' (max 64 characters).");

            try
            {
                var item = await catalog.UpdateItemAsync(sku, request.Name, request.Price, barcode, request.CategoryId, request.ImageUrl, request.Location, cancellationToken);
                return Results.Ok(item);
            }
            catch (CatalogItemsNotFoundException ex)
            {
                return Results.NotFound(ex.Message);
            }
            catch (ItemAlreadyExistsException ex)
            {
                return Results.Conflict(ex.Message);
            }
            catch (CatalogRuleException ex)
            {
                return Results.BadRequest(ex.Message);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly);

        // Deletes an item for good. Stock goes first, then the catalog entry: if the second step
        // fails the item is simply left with no stock and the delete can be retried, whereas the
        // other order could leave stock behind for an item that no longer exists. Whatever was on
        // hand is written off in the ledger; past sales stay in the reports.
        app.MapDelete("/items/{sku}", async (string sku, CatalogApiClient catalog, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            // Checked before touching stock, so a mistyped SKU can't write anything off.
            if ((await catalog.GetAllItemsAsync(cancellationToken)).All(i => i.Sku != sku))
                return Results.NotFound($"No catalog item found for SKU '{sku}'.");

            var writtenOff = await inventory.RemoveStockAsync(sku, cancellationToken);
            try
            {
                await catalog.DeleteItemAsync(sku, cancellationToken);
            }
            catch (CatalogItemsNotFoundException)
            {
                // Someone else deleted it in the same moment: it is gone, which is what was asked.
            }
            return Results.Ok(new DeleteItemResponse(sku, writtenOff));
        }).RequireAuthorization(AuthPolicies.AdminOnly);
    }
}

public record DeleteItemResponse(string Sku, int UnitsWrittenOff);
public record UpdateItemRequestBody(string Name, decimal Price, string Barcode, Guid? CategoryId, string? ImageUrl, string? Location = null);
