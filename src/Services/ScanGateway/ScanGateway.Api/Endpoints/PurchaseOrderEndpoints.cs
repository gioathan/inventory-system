using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class PurchaseOrderEndpoints
{
    public static void MapPurchaseOrderEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/purchase-orders").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapPost("", async (
            CreatePurchaseOrderRequest request, InventoryApiClient inventory, CatalogApiClient catalog, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.SupplierName) || request.SupplierName.Length > MaxSupplierNameLength)
                return Results.BadRequest($"A supplier name of 1 to {MaxSupplierNameLength} characters is required.");

            if (ValidateLines(request.Lines) is { } problem)
                return Results.BadRequest(problem);

            // The saga trusts the SKUs it is given, so an order for something the catalog has never
            // heard of would sit there until a shipment arrived and stocked a phantom item.
            var known = (await catalog.GetAllItemsAsync(cancellationToken)).Select(i => i.Sku).ToHashSet();
            var unknown = request.Lines.Select(l => l.Sku).Where(sku => !known.Contains(sku)).ToList();
            if (unknown.Count > 0)
                return Results.BadRequest($"Unknown SKU(s): {string.Join(", ", unknown)}.");

            var order = await inventory.CreatePurchaseOrderAsync(
                request.SupplierName, request.Lines.Select(l => new PurchaseOrderLine(l.Sku, l.Quantity)), cancellationToken);

            return Results.Created($"/purchase-orders/{order.Id}", ToResponse(order));
        });

        group.MapGet("", async (InventoryApiClient inventory, CancellationToken cancellationToken) =>
            Results.Ok((await inventory.ListPurchaseOrdersAsync(cancellationToken)).Select(ToResponse)));

        // Through RunAsync like the actions below: the client throws on a NotFound rather than
        // returning null, so a bare null check here never fired and an unknown id came back as a 500.
        group.MapGet("/{id:guid}", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
            await RunAsync(() => inventory.GetPurchaseOrderAsync(id, cancellationToken)));

        // The saga does the actual work (Sent/Received/Cancelled) — these three routes only
        // differ in which command they send it; see InventoryApiClient/PurchaseOrder saga.
        group.MapPost("/{id:guid}/send", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
            await RunAsync(() => inventory.SendPurchaseOrderAsync(id, cancellationToken)));

        group.MapPost("/{id:guid}/receive", async (Guid id, ReceiveShipmentRequest request, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            if (ValidateLines(request.Lines) is { } problem)
                return Results.BadRequest(problem);

            return await RunAsync(() => inventory.ReceivePurchaseOrderShipmentAsync(
                id, request.Lines.Select(l => new PurchaseOrderLine(l.Sku, l.Quantity)), cancellationToken));
        });

        group.MapPost("/{id:guid}/cancel", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
            await RunAsync(() => inventory.CancelPurchaseOrderAsync(id, cancellationToken)));
    }

    private const int MaxSupplierNameLength = 200;
    private const int MaxLines = 200;
    private const int MaxQuantity = 99_999;

    // Shared by create and receive: the saga and the receiving service each reject some of these,
    // but as unhandled errors deep inside a transaction (a 500), not a clear message. Catching them
    // here turns them into a 400 the caller can act on.
    private static string? ValidateLines(List<PurchaseOrderLineRequest>? lines)
    {
        if (lines is null || lines.Count == 0)
            return "At least one line is required.";
        if (lines.Count > MaxLines)
            return $"At most {MaxLines} lines are allowed.";
        if (lines.Any(l => string.IsNullOrWhiteSpace(l.Sku)))
            return "Every line needs a SKU.";
        if (lines.Any(l => l.Quantity < 1 || l.Quantity > MaxQuantity))
            return $"Each quantity must be between 1 and {MaxQuantity}.";
        if (lines.Select(l => l.Sku).Distinct().Count() != lines.Count)
            return "Each SKU may appear only once.";
        return null;
    }

    private static async Task<IResult> RunAsync(Func<Task<PurchaseOrder?>> action)
    {
        try
        {
            var order = await action();
            return order is null ? Results.NotFound() : Results.Ok(ToResponse(order));
        }
        catch (PurchaseOrderOperationException ex) when (ex.StatusCode == global::Grpc.Core.StatusCode.NotFound)
        {
            return Results.NotFound(ex.Message);
        }
        catch (PurchaseOrderOperationException ex)
        {
            // FailedPrecondition — an invalid state transition (see the saga's Handle methods),
            // not a client input error: 409 Conflict, not 400.
            return Results.Conflict(ex.Message);
        }
    }

    private static PurchaseOrderResponse ToResponse(PurchaseOrder order) => new(
        order.Id, order.SupplierName, order.Status,
        order.Lines.Select(l => new PurchaseOrderLineResponse(l.Sku, l.Quantity, l.ReceivedQuantity)).ToList(),
        order.OpenedAt, order.ClosedAt);
}

public record PurchaseOrderLineRequest(string Sku, int Quantity);
public record CreatePurchaseOrderRequest(string SupplierName, List<PurchaseOrderLineRequest> Lines);
public record ReceiveShipmentRequest(List<PurchaseOrderLineRequest> Lines);

public record PurchaseOrderLineResponse(string Sku, int OrderedQuantity, int ReceivedQuantity);
public record PurchaseOrderResponse(
    Guid Id, string SupplierName, string Status, List<PurchaseOrderLineResponse> Lines,
    DateTimeOffset OpenedAt, DateTimeOffset? ClosedAt);
