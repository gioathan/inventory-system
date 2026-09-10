namespace InventorySystem.Catalog.Api.Data;

public class Item
{
    public Guid Id { get; set; }
    public required string Sku { get; set; }
    public required string Name { get; set; }
    public required string Barcode { get; set; }
    public required decimal Price { get; set; }
    public string? ImageUrl { get; set; }
    public Guid? CategoryId { get; set; }
}
