using InventorySystem.Inventory.Api.Services;
using InventorySystem.Inventory.Api.Services.PurchaseOrders;
using Wolverine;

namespace InventorySystem.Inventory.Api.Data;

public enum PurchaseOrderStatus
{
    Draft,
    Sent,
    PartiallyReceived,
    Received,
    Cancelled
}

// One line per ordered SKU — OrderedQuantity never changes after the PO is created;
// ReceivedQuantity accumulates across however many shipments it takes to fill it, possibly
// arriving over several real-world days as separate ReceivePurchaseOrderShipment commands.
public class PurchaseOrderLine
{
    public Guid Id { get; set; }
    public required string Sku { get; set; }
    public int OrderedQuantity { get; set; }
    public int ReceivedQuantity { get; set; }
}

// A Wolverine saga: state that persists across however many messages it takes to reach a
// terminal status, unlike everything else in this service (StockReceivingService etc.), which
// handles one message/request and is done. Wolverine correlates each subsequent command to this
// instance via a property marked [SagaIdentity] on the command (see PurchaseOrderCommands.cs)
// matching this class's Id, loads it, runs the matching Handle method, and persists whatever
// changed — through the same InventoryDbContext/outbox transaction as everything else here.
//
// Start/Handle live directly on this class (rather than split into a separate file/namespace,
// which was tried first and fails: C# partial classes across two files must share one
// namespace, and Wolverine convention wants Start/Handle recognizable on the saga type itself).
public class PurchaseOrder : Saga
{
    public Guid Id { get; set; }
    public required string SupplierName { get; set; }
    public PurchaseOrderStatus Status { get; set; }
    public List<PurchaseOrderLine> Lines { get; set; } = [];
    public DateTimeOffset OpenedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }

    public static PurchaseOrder Start(CreatePurchaseOrder command)
    {
        if (command.Lines.Count == 0)
            throw new ArgumentException("A purchase order needs at least one line.");

        return new PurchaseOrder
        {
            Id = command.PurchaseOrderId,
            SupplierName = command.SupplierName,
            Status = PurchaseOrderStatus.Draft,
            OpenedAt = DateTimeOffset.UtcNow,
            Lines = command.Lines
                .Select(l => new PurchaseOrderLine { Id = Guid.NewGuid(), Sku = l.Sku, OrderedQuantity = l.Quantity })
                .ToList()
        };
    }

    public void Handle(SendPurchaseOrder command)
    {
        if (Status != PurchaseOrderStatus.Draft)
            throw new InvalidOperationException($"Purchase order {Id} is '{Status}', not Draft — only a Draft order can be sent.");

        Status = PurchaseOrderStatus.Sent;
    }

    // The one handler that reaches outside the saga's own state — every received unit has to
    // actually land in real stock. Can't call StockReceivingService.ReceiveStockAsync directly
    // here: this Handle method already runs inside Wolverine's own ambient transaction (from
    // UseEntityFrameworkCoreTransactions), and that method opens a second transaction of its
    // own, which Npgsql refuses ("connection is already in a transaction"). Its
    // ReceiveStockWithinAmbientTransactionAsync sibling does the same upsert+ledger write
    // without trying to own the transaction, and hands back the StockMovementRecorded event
    // instead of publishing it — returned below as a Wolverine cascading message, so it still
    // only ships once the ambient transaction actually commits.
    public async Task<IEnumerable<object>> Handle(
        ReceivePurchaseOrderShipment command, StockReceivingService receiving, CancellationToken cancellationToken)
    {
        if (Status is not (PurchaseOrderStatus.Sent or PurchaseOrderStatus.PartiallyReceived))
            throw new InvalidOperationException(
                $"Purchase order {Id} is '{Status}' — a shipment can only be received against a Sent or PartiallyReceived order.");

        var events = new List<object>();
        foreach (var received in command.Lines)
        {
            var line = Lines.FirstOrDefault(l => l.Sku == received.Sku)
                ?? throw new InvalidOperationException($"SKU '{received.Sku}' is not on purchase order {Id}.");

            line.ReceivedQuantity += received.Quantity;
            var (_, @event) = await receiving.ReceiveStockWithinAmbientTransactionAsync(
                received.Sku, received.Quantity, StockMovementReason.PurchaseOrderReceipt, cancellationToken);
            events.Add(@event);
        }

        if (Lines.All(l => l.ReceivedQuantity >= l.OrderedQuantity))
        {
            Status = PurchaseOrderStatus.Received;
            ClosedAt = DateTimeOffset.UtcNow;
            // Deliberately no MarkCompleted() here — that tells Wolverine to delete this
            // instance once it's terminal, but a Received/Cancelled order should stay queryable
            // forever (same as RestockSession's own OpenedAt/ClosedAt: closed, never deleted).
            // Nothing routes further messages to a Received/Cancelled order anyway — the guard
            // clauses above and below already refuse to touch one, so there's nothing left for
            // "stop persisting this" to protect against.
        }
        else
        {
            Status = PurchaseOrderStatus.PartiallyReceived;
        }

        return events;
    }

    public void Handle(CancelPurchaseOrder command)
    {
        if (Status is PurchaseOrderStatus.Received or PurchaseOrderStatus.Cancelled)
            throw new InvalidOperationException($"Purchase order {Id} is already '{Status}' — nothing to cancel.");

        Status = PurchaseOrderStatus.Cancelled;
        ClosedAt = DateTimeOffset.UtcNow;
        // See the comment on the Received branch above — no MarkCompleted() here either.
    }
}
