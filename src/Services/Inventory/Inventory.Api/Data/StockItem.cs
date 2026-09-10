namespace InventorySystem.Inventory.Api.Data;

public class StockItem
{
    public Guid Id { get; set; }
    public required string Sku { get; set; }
    public int QuantityOnHand { get; set; }
}
