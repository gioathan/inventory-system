namespace InventorySystem.Messaging.Contracts.Events;

// Published by Inventory.Api's transactional outbox every time a StockMovement row is written —
// one event per movement, mirroring the ledger row itself. Consumers (Notification, eventually
// Reporting) get exactly what Inventory persisted, never a derived/summarized view.
public record StockMovementRecorded(
    string Sku,
    int Delta,
    string Reason,
    DateTimeOffset Timestamp,
    int ResultingQuantity,
    Guid? SessionId);
