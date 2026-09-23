using Wolverine.Persistence.Sagas;

namespace InventorySystem.Inventory.Api.Services.PurchaseOrders;

public record PurchaseOrderLineInput(string Sku, int Quantity);

// The caller (the gRPC handler) generates the id up front rather than letting Start() invent
// one internally — InvokeAsync doesn't hand back the created saga, so this is how the RPC knows
// what id to report back to the client without a second round trip.
public record CreatePurchaseOrder(Guid PurchaseOrderId, string SupplierName, List<PurchaseOrderLineInput> Lines);

// Every subsequent command targets an already-running saga. [SagaIdentity] tells Wolverine
// which property to match against PurchaseOrder.Id when loading the instance to hand the
// message to — without it, Wolverine has no way to know these commands are even saga-related.
public record SendPurchaseOrder([property: SagaIdentity] Guid PurchaseOrderId);

public record ReceivePurchaseOrderShipment(
    [property: SagaIdentity] Guid PurchaseOrderId, List<PurchaseOrderLineInput> Lines);

public record CancelPurchaseOrder([property: SagaIdentity] Guid PurchaseOrderId);
