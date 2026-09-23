namespace InventorySystem.Inventory.Api.Data;

public enum StockMovementReason
{
    Intake,
    Restock,
    Sale,
    ManualAdjust,
    PurchaseOrderReceipt
}

// Append-only ledger row for every quantity change — never updated or deleted. QuantityOnHand
// on StockItem is the current total; this table is the history that total can't tell you on its own.
public class StockMovement
{
    public Guid Id { get; set; }
    public required string Sku { get; set; }
    public int Delta { get; set; }
    public StockMovementReason Reason { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public int ResultingQuantity { get; set; }
    public Guid? SessionId { get; set; }
}
