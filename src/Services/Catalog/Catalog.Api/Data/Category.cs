namespace InventorySystem.Catalog.Api.Data;

// Categories form a tree: ParentId is null for a top-level category, otherwise the category it
// sits inside ("Earrings" inside "Jewelry"). One parent each, so a category can never appear
// twice in its own chain. Items belong in categories with no children — see
// CatalogGrpcServiceImpl.RequireAssignableCategoryAsync.
public class Category
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public Guid? ParentId { get; set; }
}
