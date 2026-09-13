using InventorySystem.Messaging.Contracts.Events;
using InventorySystem.Notification.Api.Data;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace InventorySystem.Notification.Api.Handlers;

// Wolverine discovers this by convention: a public "Handle" method on a class ending in
// "Handler", with the message as its first parameter. Additional parameters (IMongoDatabase,
// IConfiguration, ILogger<T>) are resolved from DI per-message, the same way minimal API
// endpoint parameters are — no constructor or interface to implement.
public class StockMovementRecordedHandler
{
    public static async Task Handle(
        StockMovementRecorded message,
        IMongoDatabase db,
        IConfiguration configuration,
        ILogger<StockMovementRecordedHandler> logger)
    {
        // Only a decrease can newly cross a low-stock line; an intake/restock (positive Delta)
        // never needs an alert even if it happens to land at or below threshold.
        if (message.Delta >= 0)
            return;

        var threshold = configuration.GetValue("LowStock:Threshold", 5);
        if (message.ResultingQuantity > threshold)
            return;

        logger.LogInformation(
            "Low stock: {Sku} at {Quantity} (threshold {Threshold})",
            message.Sku, message.ResultingQuantity, threshold);

        await db.GetCollection<LowStockAlert>("LowStockAlerts").InsertOneAsync(new LowStockAlert
        {
            Sku = message.Sku,
            QuantityOnHand = message.ResultingQuantity,
            Threshold = threshold,
            Timestamp = message.Timestamp
        });
    }
}
