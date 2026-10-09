using global::Grpc.Core;
using InventorySystem.Auth.Contracts;
using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Services;
using InventorySystem.Inventory.Api.Services.PurchaseOrders;
using InventorySystem.Grpc.Contracts.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Wolverine;
// The domain layer and the generated proto both define a few of the same type names
// (SessionSummaryLine, PurchaseOrderLineInput, PurchaseOrderStatus) — alias the wire-format
// ones so usage below stays unambiguous without fully qualifying every reference.
using GrpcSessionSummaryLine = InventorySystem.Grpc.Contracts.Inventory.SessionSummaryLine;
using GrpcPurchaseOrderLineInput = InventorySystem.Grpc.Contracts.Inventory.PurchaseOrderLineInput;
using GrpcPurchaseOrderStatus = InventorySystem.Grpc.Contracts.Inventory.PurchaseOrderStatus;

namespace InventorySystem.Inventory.Api.Grpc;

// Class-level policy is the floor every RPC needs; GetSessionSummary adds a second, stricter
// policy on top (see below) — [Authorize] attributes combine with AND, so a Seller passes this
// one but still fails that stricter one, landing at Admin-only in practice for that one RPC.
[Authorize(Policy = AuthPolicies.SellerOrAdmin)]
public class InventoryGrpcServiceImpl(
    InventoryDbContext db, StockReceivingService receiving, RestockSessionService sessions, IMessageBus bus)
    : InventoryGrpcService.InventoryGrpcServiceBase
{
    public override async Task<StockReply> GetStock(GetStockRequest request, ServerCallContext context)
    {
        var item = await db.StockItems.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Sku == request.Sku, context.CancellationToken);

        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No stock record found for SKU '{request.Sku}'."));

        return ToReply(item);
    }

    public override async Task<ListStockReply> ListStock(ListStockRequest request, ServerCallContext context)
    {
        var items = await db.StockItems.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListStockReply();
        reply.Stock.AddRange(items.Select(ToReply));
        return reply;
    }

    // Admin-only, matching Scan Gateway's receive/intake routes — the only callers.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<StockReply> ReceiveStock(ReceiveStockRequest request, ServerCallContext context)
    {
        if (request.Quantity <= 0)
            throw new RpcException(new Status(StatusCode.InvalidArgument, "Quantity must be positive."));

        var item = await receiving.ReceiveStockAsync(request.Sku, request.Quantity, ToDomainReason(request.Reason), context.CancellationToken);
        return ToReply(item);
    }

    // Scan Gateway's scan-to-sell action calls this with a negative Delta and Reason.Sale — the
    // same atomic floor-at-zero guard as the REST /adjust endpoint, just reachable internally.
    public override async Task<StockReply> AdjustStock(AdjustStockRequest request, ServerCallContext context)
    {
        decimal? unitPrice = null;
        if (request.HasUnitPrice)
        {
            if (!decimal.TryParse(request.UnitPrice, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var parsed) || parsed < 0)
                throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{request.UnitPrice}' is not a valid unit price."));
            unitPrice = parsed;
        }

        var result = await receiving.AdjustStockAsync(request.Sku, request.Delta, ToDomainReason(request.Reason), context.CancellationToken, unitPrice);

        return result.Outcome switch
        {
            AdjustStockOutcome.NotFound => throw new RpcException(new Status(StatusCode.NotFound, $"No stock record found for SKU '{request.Sku}'.")),
            AdjustStockOutcome.InsufficientStock => throw new RpcException(new Status(StatusCode.FailedPrecondition, $"Insufficient stock for '{request.Sku}'.")),
            _ => ToReply(result.Item!)
        };
    }

    // Revenue-adjacent reporting data — Admin-only, matching Dashboard's sessionReport.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<SessionSummaryReply> GetSessionSummary(GetSessionSummaryRequest request, ServerCallContext context)
    {
        if (!Guid.TryParse(request.SessionId, out var sessionId))
            throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{request.SessionId}' is not a valid session id."));

        var lines = await sessions.GetSummaryAsync(sessionId, context.CancellationToken)
            ?? throw new RpcException(new Status(StatusCode.NotFound, $"No restock session found with id '{sessionId}'."));

        var reply = new SessionSummaryReply();
        reply.Lines.AddRange(lines.Select(l => new GrpcSessionSummaryLine
        {
            Sku = l.Sku,
            Restocked = l.Restocked,
            Sold = l.Sold,
            NetDelta = l.NetDelta,
            OpeningQuantity = l.OpeningQuantity,
            ClosingQuantity = l.ClosingQuantity,
            RecordedRevenue = l.RecordedRevenue.ToString(System.Globalization.CultureInfo.InvariantCulture),
            UnpricedSold = l.UnpricedSold
        }));
        return reply;
    }

    // Stays at the class-level SellerOrAdmin floor on purpose: counts only, no revenue, so the
    // Stock and Scan screens can show sellers what's moving in the current session.
    public override async Task<CurrentSessionSalesReply> GetCurrentSessionSales(GetCurrentSessionSalesRequest request, ServerCallContext context)
    {
        var reply = new CurrentSessionSalesReply();
        var current = await sessions.GetCurrentAsync(context.CancellationToken);
        if (current is null)
            return reply;

        reply.Session = ToReply(current);
        var lines = await sessions.GetSummaryAsync(current.Id, context.CancellationToken) ?? [];
        reply.Lines.AddRange(lines.Select(l => new SessionSalesLine { Sku = l.Sku, Sold = l.Sold, Restocked = l.Restocked }));
        return reply;
    }

    // Starting/ending a restocking period and browsing past ones is admin work, same as the REST
    // routes. GetCurrent stays at the class-level SellerOrAdmin floor: the Receive screen shows
    // sellers which session their scans are being logged to.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<OpenRestockSessionReply> OpenRestockSession(OpenRestockSessionRequest request, ServerCallContext context)
    {
        try
        {
            var (opened, closed) = await sessions.OpenAsync(request.HasNote ? request.Note : null, context.CancellationToken);
            var reply = new OpenRestockSessionReply { Opened = ToReply(opened) };
            if (closed is not null)
                reply.Closed = ToReply(closed);
            return reply;
        }
        catch (InvalidOperationException ex)
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, ex.Message));
        }
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<RestockSessionReply> CloseRestockSession(RestockSessionIdRequest request, ServerCallContext context)
    {
        if (!Guid.TryParse(request.SessionId, out var sessionId))
            throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{request.SessionId}' is not a valid session id."));

        try
        {
            var session = await sessions.CloseAsync(sessionId, context.CancellationToken)
                ?? throw new RpcException(new Status(StatusCode.NotFound, $"No restock session found with id '{sessionId}'."));
            return ToReply(session);
        }
        catch (InvalidOperationException ex)
        {
            throw new RpcException(new Status(StatusCode.FailedPrecondition, ex.Message));
        }
    }

    public override async Task<CurrentRestockSessionReply> GetCurrentRestockSession(GetCurrentRestockSessionRequest request, ServerCallContext context)
    {
        var session = await sessions.GetCurrentAsync(context.CancellationToken);
        return session is null ? new CurrentRestockSessionReply() : new CurrentRestockSessionReply { Session = ToReply(session) };
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ListRestockSessionsReply> ListRestockSessions(ListRestockSessionsRequest request, ServerCallContext context)
    {
        var reply = new ListRestockSessionsReply();
        reply.Sessions.AddRange((await sessions.ListAsync(context.CancellationToken)).Select(ToReply));
        return reply;
    }

    private static RestockSessionReply ToReply(RestockSession session)
    {
        var reply = new RestockSessionReply { Id = session.Id.ToString(), OpenedAt = session.OpenedAt.ToString("O") };
        if (session.ClosedAt is { } closedAt)
            reply.ClosedAt = closedAt.ToString("O");
        if (session.Note is not null)
            reply.Note = session.Note;
        return reply;
    }

    // Purchase orders are admin-managed setup like categories/sessions, not a day-to-day
    // seller action — every RPC below is Admin-only.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<PurchaseOrderReply> CreatePurchaseOrder(CreatePurchaseOrderRequest request, ServerCallContext context)
    {
        if (request.Lines.Count == 0)
            throw new RpcException(new Status(StatusCode.InvalidArgument, "A purchase order needs at least one line."));

        var id = Guid.NewGuid();
        var command = new CreatePurchaseOrder(id, request.SupplierName, request.Lines.Select(ToLineInput).ToList());

        await InvokeSagaCommandAsync(command, context.CancellationToken);
        return await LoadReplyAsync(id, context.CancellationToken);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<PurchaseOrderReply> SendPurchaseOrder(PurchaseOrderIdRequest request, ServerCallContext context)
    {
        var id = ParseId(request.PurchaseOrderId);
        await InvokeSagaCommandAsync(new SendPurchaseOrder(id), context.CancellationToken);
        return await LoadReplyAsync(id, context.CancellationToken);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<PurchaseOrderReply> ReceivePurchaseOrderShipment(ReceivePurchaseOrderShipmentRequest request, ServerCallContext context)
    {
        var id = ParseId(request.PurchaseOrderId);
        var command = new ReceivePurchaseOrderShipment(id, request.Lines.Select(ToLineInput).ToList());

        await InvokeSagaCommandAsync(command, context.CancellationToken);
        return await LoadReplyAsync(id, context.CancellationToken);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<PurchaseOrderReply> CancelPurchaseOrder(PurchaseOrderIdRequest request, ServerCallContext context)
    {
        var id = ParseId(request.PurchaseOrderId);
        await InvokeSagaCommandAsync(new CancelPurchaseOrder(id), context.CancellationToken);
        return await LoadReplyAsync(id, context.CancellationToken);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<PurchaseOrderReply> GetPurchaseOrder(PurchaseOrderIdRequest request, ServerCallContext context) =>
        await LoadReplyAsync(ParseId(request.PurchaseOrderId), context.CancellationToken);

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ListPurchaseOrdersReply> ListPurchaseOrders(ListPurchaseOrdersRequest request, ServerCallContext context)
    {
        var orders = await db.PurchaseOrders.AsNoTracking().Include(o => o.Lines).ToListAsync(context.CancellationToken);

        var reply = new ListPurchaseOrdersReply();
        reply.PurchaseOrders.AddRange(orders.Select(ToReply));
        return reply;
    }

    // IMessageBus.InvokeAsync runs the command through Wolverine's full pipeline in-process and
    // waits for it to finish — the saga is loaded, the matching Handle method runs, and the
    // result is persisted through the same InventoryDbContext transaction/outbox everything
    // else here uses, all before this call returns. Domain rule violations (e.g. sending an
    // already-Sent order) surface as InvalidOperationException from the saga's own Handle
    // methods — translated to a gRPC status here rather than an opaque 500.
    private async Task InvokeSagaCommandAsync(object command, CancellationToken cancellationToken)
    {
        try
        {
            await bus.InvokeAsync(command, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            throw new RpcException(new Status(StatusCode.FailedPrecondition, ex.Message));
        }
    }

    private async Task<PurchaseOrderReply> LoadReplyAsync(Guid id, CancellationToken cancellationToken)
    {
        var order = await db.PurchaseOrders.AsNoTracking().Include(o => o.Lines)
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);

        return order is null
            ? throw new RpcException(new Status(StatusCode.NotFound, $"No purchase order found with id '{id}'."))
            : ToReply(order);
    }

    private static Guid ParseId(string value) =>
        Guid.TryParse(value, out var id)
            ? id
            : throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{value}' is not a valid purchase order id."));

    private static Services.PurchaseOrders.PurchaseOrderLineInput ToLineInput(GrpcPurchaseOrderLineInput line) =>
        new(line.Sku, line.Quantity);

    private static GrpcPurchaseOrderStatus ToWireStatus(Data.PurchaseOrderStatus status) => status switch
    {
        Data.PurchaseOrderStatus.Draft => GrpcPurchaseOrderStatus.Draft,
        Data.PurchaseOrderStatus.Sent => GrpcPurchaseOrderStatus.Sent,
        Data.PurchaseOrderStatus.PartiallyReceived => GrpcPurchaseOrderStatus.PartiallyReceived,
        Data.PurchaseOrderStatus.Received => GrpcPurchaseOrderStatus.Received,
        Data.PurchaseOrderStatus.Cancelled => GrpcPurchaseOrderStatus.Cancelled,
        _ => throw new ArgumentOutOfRangeException(nameof(status))
    };

    private static PurchaseOrderReply ToReply(PurchaseOrder order)
    {
        var reply = new PurchaseOrderReply
        {
            Id = order.Id.ToString(),
            SupplierName = order.SupplierName,
            Status = ToWireStatus(order.Status),
            OpenedAt = order.OpenedAt.ToString("O")
        };
        reply.Lines.AddRange(order.Lines.Select(l => new PurchaseOrderLineReply
        {
            Sku = l.Sku,
            OrderedQuantity = l.OrderedQuantity,
            ReceivedQuantity = l.ReceivedQuantity
        }));

        if (order.ClosedAt is { } closedAt)
            reply.ClosedAt = closedAt.ToString("O");

        return reply;
    }

    private static StockReply ToReply(StockItem item) =>
        new() { Sku = item.Sku, QuantityOnHand = item.QuantityOnHand };

    private static StockMovementReason ToDomainReason(MovementReason reason) => reason switch
    {
        MovementReason.Intake => StockMovementReason.Intake,
        MovementReason.Sale => StockMovementReason.Sale,
        MovementReason.ManualAdjust => StockMovementReason.ManualAdjust,
        _ => StockMovementReason.Restock
    };
}
