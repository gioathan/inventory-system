using InventorySystem.Notification.Api.Data;
using MongoDB.Driver;

namespace InventorySystem.Notification.Api.Endpoints;

public static class AlertEndpoints
{
    public static void MapAlertEndpoints(this WebApplication app)
    {
        // No outbound channel (email/push/webhook) exists yet — this is the only way to see
        // alerts today: poll this list. See TECH_DEBT.md.
        app.MapGet("/alerts", async (IMongoDatabase db, string? sku) =>
        {
            var collection = db.GetCollection<LowStockAlert>("LowStockAlerts");
            var filter = sku is null
                ? Builders<LowStockAlert>.Filter.Empty
                : Builders<LowStockAlert>.Filter.Eq(a => a.Sku, sku);

            var alerts = await collection.Find(filter)
                .SortByDescending(a => a.Timestamp)
                .Limit(100)
                .ToListAsync();

            return Results.Ok(alerts.Select(a => new AlertResponse(a.Sku, a.QuantityOnHand, a.Threshold, a.Timestamp)));
        });
    }
}

public record AlertResponse(string Sku, int QuantityOnHand, int Threshold, DateTimeOffset Timestamp);
