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

    // Fraction in (0, 1) taken off Price; null means no active discount. Price itself is never
    // overwritten by a discount, so clearing this back to null is an exact, lossless revert.
    public double? DiscountPercentage { get; set; }
}
