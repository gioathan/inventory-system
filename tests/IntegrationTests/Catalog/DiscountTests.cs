using System.Globalization;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Catalog;

// Covers the "apply a percentage off to a batch of items for a low-price period, then remove
// it" flow end to end over the same gRPC surface Scan Gateway's /items/discount fronts.
public class DiscountTests
{
    private static async Task<(DistributedApplication App, CatalogGrpcService.CatalogGrpcServiceClient Catalog, Metadata Auth)> StartAsync(CancellationToken token)
    {
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        var app = await appHost.BuildAsync(token);
        await app.StartAsync(token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("catalog-api", token);

        var authHeaders = AuthTestHelper.BearerHeaders(await app.LoginAsAdminAsync(token));

        return (app, app.CreateCatalogGrpcClient(), authHeaders);
    }

    private static Task<ItemReply> CreateItemAsync(
        CatalogGrpcService.CatalogGrpcServiceClient catalog, Metadata auth, string skuPrefix, string price, CancellationToken token) =>
        catalog.CreateItemAsync(
            new CreateItemRequest { Name = "Discount Test Item", Sku = $"{skuPrefix}-{Guid.NewGuid():N}", Price = price },
            headers: auth, cancellationToken: token).ResponseAsync;

    [Fact]
    public async Task ApplyDiscount_ToMultipleSkus_ComputesEffectivePriceOnEach()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var itemA = await CreateItemAsync(catalog, auth, "DISCOUNT-TEST-A", "100", cts.Token);
        var itemB = await CreateItemAsync(catalog, auth, "DISCOUNT-TEST-B", "50", cts.Token);

        var request = new ApplyDiscountRequest { Percentage = 0.2 };
        request.Skus.Add(itemA.Sku);
        request.Skus.Add(itemB.Sku);

        var reply = await catalog.ApplyDiscountAsync(request, headers: auth, cancellationToken: cts.Token);

        Assert.Equal(2, reply.Items.Count);
        var resultA = Assert.Single(reply.Items, i => i.Sku == itemA.Sku);
        var resultB = Assert.Single(reply.Items, i => i.Sku == itemB.Sku);

        Assert.Equal(0.2, resultA.DiscountPercentage);
        Assert.Equal(80m, Decimal(resultA.EffectivePrice));
        Assert.Equal(0.2, resultB.DiscountPercentage);
        Assert.Equal(40m, Decimal(resultB.EffectivePrice));

        // Price itself is untouched — the whole point of not overwriting it.
        Assert.Equal(100m, Decimal(resultA.Price));
        Assert.Equal(50m, Decimal(resultB.Price));
    }

    [Fact]
    public async Task RemoveDiscount_RevertsEffectivePriceToPlainPrice()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var item = await CreateItemAsync(catalog, auth, "DISCOUNT-TEST-REMOVE", "100", cts.Token);

        var apply = new ApplyDiscountRequest { Percentage = 0.5 };
        apply.Skus.Add(item.Sku);
        await catalog.ApplyDiscountAsync(apply, headers: auth, cancellationToken: cts.Token);

        var remove = new RemoveDiscountRequest();
        remove.Skus.Add(item.Sku);
        var reply = await catalog.RemoveDiscountAsync(remove, headers: auth, cancellationToken: cts.Token);

        var result = Assert.Single(reply.Items);
        Assert.False(result.HasDiscountPercentage);
        Assert.Equal(100m, Decimal(result.EffectivePrice));
        Assert.Equal(100m, Decimal(result.Price));
    }

    private static decimal Decimal(string value) => decimal.Parse(value, CultureInfo.InvariantCulture);

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(-0.1)]
    public async Task ApplyDiscount_WithPercentageOutsideExclusiveRange_ReturnsInvalidArgument(double percentage)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var item = await CreateItemAsync(catalog, auth, "DISCOUNT-TEST-INVALID", "100", cts.Token);

        var request = new ApplyDiscountRequest { Percentage = percentage };
        request.Skus.Add(item.Sku);

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            catalog.ApplyDiscountAsync(request, headers: auth, cancellationToken: cts.Token).ResponseAsync);

        Assert.Equal(StatusCode.InvalidArgument, ex.StatusCode);
    }

    [Fact]
    public async Task ApplyDiscount_WithUnknownSku_ReturnsNotFoundAndAppliesNothing()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var (app, catalog, auth) = await StartAsync(cts.Token);
        await using var _ = app;

        var known = await CreateItemAsync(catalog, auth, "DISCOUNT-TEST-PARTIAL", "100", cts.Token);

        var request = new ApplyDiscountRequest { Percentage = 0.3 };
        request.Skus.Add(known.Sku);
        request.Skus.Add("DISCOUNT-TEST-DOES-NOT-EXIST");

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            catalog.ApplyDiscountAsync(request, headers: auth, cancellationToken: cts.Token).ResponseAsync);
        Assert.Equal(StatusCode.NotFound, ex.StatusCode);

        // All-or-nothing: the known SKU must not have been discounted by the failed batch call.
        var found = await catalog.GetItemByBarcodeAsync(
            new GetItemByBarcodeRequest { Barcode = known.Barcode }, headers: auth, cancellationToken: cts.Token);
        Assert.False(found.HasDiscountPercentage);
    }
}
