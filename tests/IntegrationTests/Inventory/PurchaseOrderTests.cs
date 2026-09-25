using Aspire.Hosting;
using Aspire.Hosting.Testing;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Inventory;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Inventory;

// Covers the Wolverine saga end to end — the one part of this system where state persists
// across multiple messages rather than being handled and forgotten. Each test spins up its own
// AppHost like every other integration test here, then drives the saga through real gRPC calls
// exactly as ScanGateway's REST endpoints do internally.
public class PurchaseOrderTests
{
    private static async Task<(DistributedApplication App, InventoryGrpcService.InventoryGrpcServiceClient Inventory, Metadata Auth)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("inventory-api", token);

        var authHeaders = AuthTestHelper.BearerHeaders(await app.LoginAsAdminAsync(token));

        return (app, app.CreateInventoryGrpcClient(), authHeaders);
    }

    private static PurchaseOrderLineInput Line(string sku, int quantity) => new() { Sku = sku, Quantity = quantity };

    [Fact]
    public async Task FullLifecycle_DraftSentPartiallyReceivedThenReceived_UpdatesRealStock()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, inventory, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = $"PO-TEST-{Guid.NewGuid():N}";

        var create = new CreatePurchaseOrderRequest { SupplierName = "Acme Supplies" };
        create.Lines.Add(Line(sku, 20));
        var created = await inventory.CreatePurchaseOrderAsync(create, headers: auth, cancellationToken: cts.Token);

        Assert.Equal(PurchaseOrderStatus.Draft, created.Status);
        Assert.Equal(20, created.Lines.Single().OrderedQuantity);
        Assert.Equal(0, created.Lines.Single().ReceivedQuantity);

        var sent = await inventory.SendPurchaseOrderAsync(
            new PurchaseOrderIdRequest { PurchaseOrderId = created.Id }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(PurchaseOrderStatus.Sent, sent.Status);

        var partialRequest = new ReceivePurchaseOrderShipmentRequest { PurchaseOrderId = created.Id };
        partialRequest.Lines.Add(Line(sku, 12));
        var partial = await inventory.ReceivePurchaseOrderShipmentAsync(partialRequest, headers: auth, cancellationToken: cts.Token);

        Assert.Equal(PurchaseOrderStatus.PartiallyReceived, partial.Status);
        Assert.Equal(12, partial.Lines.Single().ReceivedQuantity);

        // The real point of this test: the saga's receive step must actually move real stock,
        // through the same StockItems table everything else in this service reads.
        var stockAfterPartial = await inventory.GetStockAsync(new GetStockRequest { Sku = sku }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(12, stockAfterPartial.QuantityOnHand);

        var restRequest = new ReceivePurchaseOrderShipmentRequest { PurchaseOrderId = created.Id };
        restRequest.Lines.Add(Line(sku, 8));
        var completed = await inventory.ReceivePurchaseOrderShipmentAsync(restRequest, headers: auth, cancellationToken: cts.Token);

        Assert.Equal(PurchaseOrderStatus.Received, completed.Status);
        Assert.Equal(20, completed.Lines.Single().ReceivedQuantity);
        Assert.True(completed.HasClosedAt);

        var finalStock = await inventory.GetStockAsync(new GetStockRequest { Sku = sku }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(20, finalStock.QuantityOnHand);

        // A completed saga must still be queryable — Received/Cancelled orders are kept for
        // history, not deleted (see the comment on PurchaseOrder.Handle(ReceivePurchaseOrderShipment)).
        var reloaded = await inventory.GetPurchaseOrderAsync(
            new PurchaseOrderIdRequest { PurchaseOrderId = created.Id }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(PurchaseOrderStatus.Received, reloaded.Status);
    }

    [Fact]
    public async Task SendingAnAlreadySentOrder_ReturnsFailedPrecondition()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, inventory, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var create = new CreatePurchaseOrderRequest { SupplierName = "Acme Supplies" };
        create.Lines.Add(Line($"PO-TEST-{Guid.NewGuid():N}", 5));
        var created = await inventory.CreatePurchaseOrderAsync(create, headers: auth, cancellationToken: cts.Token);

        var idRequest = new PurchaseOrderIdRequest { PurchaseOrderId = created.Id };
        await inventory.SendPurchaseOrderAsync(idRequest, headers: auth, cancellationToken: cts.Token);

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            inventory.SendPurchaseOrderAsync(idRequest, headers: auth, cancellationToken: cts.Token).ResponseAsync);

        Assert.Equal(StatusCode.FailedPrecondition, ex.StatusCode);
    }

    [Fact]
    public async Task CancelledOrder_RefusesFurtherReceiving()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, inventory, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = $"PO-TEST-{Guid.NewGuid():N}";
        var create = new CreatePurchaseOrderRequest { SupplierName = "Acme Supplies" };
        create.Lines.Add(Line(sku, 5));
        var created = await inventory.CreatePurchaseOrderAsync(create, headers: auth, cancellationToken: cts.Token);

        var idRequest = new PurchaseOrderIdRequest { PurchaseOrderId = created.Id };
        var cancelled = await inventory.CancelPurchaseOrderAsync(idRequest, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(PurchaseOrderStatus.Cancelled, cancelled.Status);

        var receiveRequest = new ReceivePurchaseOrderShipmentRequest { PurchaseOrderId = created.Id };
        receiveRequest.Lines.Add(Line(sku, 1));

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            inventory.ReceivePurchaseOrderShipmentAsync(receiveRequest, headers: auth, cancellationToken: cts.Token).ResponseAsync);

        Assert.Equal(StatusCode.FailedPrecondition, ex.StatusCode);

        // Nothing should have reached real stock — the sku was never received.
        var ex2 = await Assert.ThrowsAsync<RpcException>(() =>
            inventory.GetStockAsync(new GetStockRequest { Sku = sku }, headers: auth, cancellationToken: cts.Token).ResponseAsync);
        Assert.Equal(StatusCode.NotFound, ex2.StatusCode);
    }
}
