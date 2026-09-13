using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace InventorySystem.Notification.Api.Data;

// One document per movement that crossed the threshold — intentionally not deduplicated per
// Sku (see TECH_DEBT.md): a Sku sitting below threshold across several sales produces one
// alert per sale, not one alert total.
public class LowStockAlert
{
    [BsonId]
    public ObjectId Id { get; set; }
    public required string Sku { get; set; }
    public int QuantityOnHand { get; set; }
    public int Threshold { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
