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

    // Where the item is kept — a shelf, an aisle, "back room, box 3". Free text and optional:
    // every shop names its storage its own way, so there is nothing here to validate or look up.
    public string? Location { get; set; }

    // Fraction in (0, 1) taken off Price; null means no active discount. Price itself is never
    // overwritten by a discount, so clearing this back to null is an exact, lossless revert.
    public double? DiscountPercentage { get; set; }
}
