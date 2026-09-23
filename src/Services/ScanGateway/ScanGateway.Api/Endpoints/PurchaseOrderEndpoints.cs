using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class PurchaseOrderEndpoints
{
    public static void MapPurchaseOrderEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/purchase-orders").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapPost("", async (CreatePurchaseOrderRequest request, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            if (request.Lines.Count == 0)
                return Results.BadRequest("At least one line is required.");

            var order = await inventory.CreatePurchaseOrderAsync(
                request.SupplierName, request.Lines.Select(l => new PurchaseOrderLine(l.Sku, l.Quantity)), cancellationToken);

            return Results.Created($"/purchase-orders/{order.Id}", ToResponse(order));
        });

        group.MapGet("", async (InventoryApiClient inventory, CancellationToken cancellationToken) =>
            Results.Ok((await inventory.ListPurchaseOrdersAsync(cancellationToken)).Select(ToResponse)));

        group.MapGet("/{id:guid}", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            var order = await inventory.GetPurchaseOrderAsync(id, cancellationToken);
            return order is null ? Results.NotFound() : Results.Ok(ToResponse(order));
        });

        // The saga does the actual work (Sent/Received/Cancelled) — these three routes only
        // differ in which command they send it; see InventoryApiClient/PurchaseOrder saga.
        group.MapPost("/{id:guid}/send", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
            await RunAsync(() => inventory.SendPurchaseOrderAsync(id, cancellationToken)));

        group.MapPost("/{id:guid}/receive", async (Guid id, ReceiveShipmentRequest request, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            if (request.Lines.Count == 0)
                return Results.BadRequest("At least one line is required.");

            return await RunAsync(() => inventory.ReceivePurchaseOrderShipmentAsync(
                id, request.Lines.Select(l => new PurchaseOrderLine(l.Sku, l.Quantity)), cancellationToken));
        });

        group.MapPost("/{id:guid}/cancel", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
            await RunAsync(() => inventory.CancelPurchaseOrderAsync(id, cancellationToken)));
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
