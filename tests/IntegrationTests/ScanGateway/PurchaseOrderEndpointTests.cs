using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.ScanGateway;

// The saga itself is covered by PurchaseOrderTests over gRPC. This drives the same thing through
// the REST gateway the frontend actually uses, and pins the input validation that lives there:
// the saga and receiving service reject some bad input too, but as unhandled errors deep inside a
// transaction (a 500), so the gateway has to catch them first and answer with a clear 400.
public class PurchaseOrderEndpointTests
{
    private static async Task<(DistributedApplication App, HttpClient ScanGateway)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("scan-gateway", token);

        var scanGateway = app.CreateHttpClient("scan-gateway");
        scanGateway.UseBearerToken(await app.LoginAsAdminAsync(token));
        return (app, scanGateway);
    }

    private static async Task<string> NewItemSkuAsync(HttpClient gateway, string name, CancellationToken token)
    {
        var response = await gateway.PostAsJsonAsync(
            "/items/intake",
            new { Name = name, Price = 5.00m, CategoryId = (Guid?)null, ImageUrl = (string?)null, Quantity = 1 },
            token);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<IntakeResult>(token))!.Sku;
    }

    [Fact]
    public async Task PurchaseOrders_ValidateInputAndEnforceTheStateMachineThroughTheGateway()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
        var (app, gateway) = await StartAsync(cts.Token);
        await using var _ = app;

        var sku = await NewItemSkuAsync(gateway, $"PO Item A {Guid.NewGuid():N}", cts.Token);
        var otherSku = await NewItemSkuAsync(gateway, $"PO Item B {Guid.NewGuid():N}", cts.Token);
        Task<HttpResponseMessage> Create(string supplier, params object[] lines) =>
            gateway.PostAsJsonAsync("/purchase-orders", new { SupplierName = supplier, Lines = lines }, cts.Token);
        static object Line(string sku, int quantity) => new { Sku = sku, Quantity = quantity };

        // An id that never existed is a 404, not a 500 (it once bypassed the handler that maps not-found).
        Assert.Equal(HttpStatusCode.NotFound, (await gateway.GetAsync($"/purchase-orders/{Guid.NewGuid()}", cts.Token)).StatusCode);

        // ---- create: every one of these must be a 400, never a 500 or a silently accepted order ----
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("   ", Line(sku, 5))).StatusCode);                 // blank supplier
        Assert.Equal(HttpStatusCode.BadRequest, (await Create(new string('x', 201), Line(sku, 5))).StatusCode);  // supplier too long
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("Acme")).StatusCode);                              // no lines
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("Acme", Line(sku, 0))).StatusCode);                // zero quantity
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("Acme", Line(sku, -3))).StatusCode);               // negative quantity
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("Acme", Line(sku, 100_000))).StatusCode);          // absurd quantity
        Assert.Equal(HttpStatusCode.BadRequest, (await Create("Acme", Line(sku, 1), Line(sku, 2))).StatusCode);  // same SKU twice
        var unknown = await Create("Acme", Line("NO-SUCH-SKU-IN-CATALOG", 5));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Contains("NO-SUCH-SKU-IN-CATALOG", await unknown.Content.ReadAsStringAsync(cts.Token));

        // ---- a valid order, then the state machine ----
        var created = await Create("Acme Supplies", Line(sku, 10));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var order = (await created.Content.ReadFromJsonAsync<PurchaseOrder>(cts.Token))!;
        Assert.Equal("Draft", order.Status);

        object[] receive(string s, int q) => [Line(s, q)];
        Task<HttpResponseMessage> Receive(params object[] lines) =>
            gateway.PostAsJsonAsync($"/purchase-orders/{order.Id}/receive", new { Lines = lines }, cts.Token);

        Assert.Equal(HttpStatusCode.Conflict, (await Receive(receive(sku, 1))).StatusCode);   // can't receive against a Draft

        Assert.Equal(HttpStatusCode.OK, (await gateway.PostAsync($"/purchase-orders/{order.Id}/send", null, cts.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await gateway.PostAsync($"/purchase-orders/{order.Id}/send", null, cts.Token)).StatusCode); // already sent

        // ---- receive: bad input is a 400; wrong-state or wrong-SKU is a 409 ----
        Assert.Equal(HttpStatusCode.BadRequest, (await Receive(receive(sku, 0))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Receive(Line(sku, 1), Line(sku, 2))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Receive()).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Receive(receive(otherSku, 1))).StatusCode); // a real SKU, but not on this order

        var partial = await Receive(receive(sku, 4));
        Assert.Equal(HttpStatusCode.OK, partial.StatusCode);
        var afterPartial = (await partial.Content.ReadFromJsonAsync<PurchaseOrder>(cts.Token))!;
        Assert.Equal("PartiallyReceived", afterPartial.Status);
        Assert.Equal(4, afterPartial.Lines.Single().ReceivedQuantity);

        // Receiving more than was ordered is allowed (a supplier over-ships); the order closes, and
        // the frontend surfaces it as a warning rather than blocking a real delivery.
        var over = await Receive(receive(sku, 9));
        var afterOver = (await over.Content.ReadFromJsonAsync<PurchaseOrder>(cts.Token))!;
        Assert.Equal("Received", afterOver.Status);
        Assert.Equal(13, afterOver.Lines.Single().ReceivedQuantity);
        Assert.NotNull(afterOver.ClosedAt);

        var stock = await gateway.GetFromJsonAsync<IntakeResult>($"/scan/{sku}", cts.Token); // barcode == sku for generated items
        Assert.Equal(1 + 13, stock!.QuantityOnHand); // 1 from intake + 13 received

        Assert.Equal(HttpStatusCode.Conflict, (await gateway.PostAsync($"/purchase-orders/{order.Id}/cancel", null, cts.Token)).StatusCode); // terminal
    }

    private record IntakeResult(string Sku, int QuantityOnHand);
    private record PurchaseOrderLine(string Sku, int OrderedQuantity, int ReceivedQuantity);
    private record PurchaseOrder(Guid Id, string Status, List<PurchaseOrderLine> Lines, DateTimeOffset? ClosedAt);
}
