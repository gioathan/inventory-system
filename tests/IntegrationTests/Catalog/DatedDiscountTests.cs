using Aspire.Hosting.Testing;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Catalog;

// Dated discounts against the real Catalog.Api: what an item costs while one is running, that
// the manual discount is left alone and wins when it's bigger, and that the price falls back by
// itself. The yearly-repeat date arithmetic has its own unit tests (DatedDiscountScheduleTests).
public class DatedDiscountTests
{
    [Fact]
    public async Task ADatedDiscountRunningToday_SetsThePrice_UnlessTheManualOneIsBigger_AndThenFallsBack()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("catalog-api", cts.Token);

        var auth = AuthTestHelper.BearerHeaders(await app.LoginAsAdminAsync(cts.Token));
        var catalog = app.CreateCatalogGrpcClient();

        async Task<string> NewItem(string price)
        {
            var sku = $"DATED-{Guid.NewGuid():N}";
            await catalog.CreateItemAsync(new CreateItemRequest { Name = "Dated test", Sku = sku, Price = price }, headers: auth, cancellationToken: cts.Token);
            return sku;
        }

        async Task<ItemReply> Item(string sku) =>
            await catalog.GetItemBySkuAsync(new GetItemBySkuRequest { Sku = sku }, headers: auth, cancellationToken: cts.Token);

        SaveDatedDiscountRequest Request(double percentage, DateTime from, DateTime to, params string[] skus)
        {
            var request = new SaveDatedDiscountRequest { Name = $"Dated {Guid.NewGuid():N}", Percentage = percentage };
            request.Periods.Add(new DatedDiscountPeriodMessage { StartDate = from.ToString("yyyy-MM-dd"), EndDate = to.ToString("yyyy-MM-dd") });
            request.Skus.AddRange(skus);
            return request;
        }

        // Yesterday to tomorrow, so the test doesn't depend on which side of midnight the shop's
        // time zone puts "today".
        var yesterday = DateTime.UtcNow.Date.AddDays(-1);
        var tomorrow = DateTime.UtcNow.Date.AddDays(1);

        var plain = await NewItem("10");
        var manualSmaller = await NewItem("10");
        var manualBigger = await NewItem("10");

        var manual = new ApplyDiscountRequest { Percentage = 0.1 };
        manual.Skus.Add(manualSmaller);
        await catalog.ApplyDiscountAsync(manual, headers: auth, cancellationToken: cts.Token);
        manual = new ApplyDiscountRequest { Percentage = 0.5 };
        manual.Skus.Add(manualBigger);
        await catalog.ApplyDiscountAsync(manual, headers: auth, cancellationToken: cts.Token);

        // ---- while it runs: 30% off, except where the manual discount is bigger ----
        var running = await catalog.SaveDatedDiscountAsync(Request(0.3, yesterday, tomorrow, plain, manualSmaller, manualBigger), headers: auth, cancellationToken: cts.Token);
        Assert.True(running.ActiveToday);
        Assert.Equal(0, running.DaysUntilNext);

        var item = await Item(plain);
        Assert.Equal("7.00", item.EffectivePrice);
        Assert.Equal(0.3, item.ActiveDiscountPercentage);
        Assert.Equal(running.Name, item.DatedDiscountName);
        Assert.False(item.HasDiscountPercentage); // the manual discount is still "none"

        item = await Item(manualSmaller);
        Assert.Equal("7.00", item.EffectivePrice);
        Assert.Equal(0.1, item.DiscountPercentage); // untouched
        Assert.Equal(0.3, item.ActiveDiscountPercentage);

        item = await Item(manualBigger);
        Assert.Equal("5.00", item.EffectivePrice);
        Assert.Equal(0.5, item.ActiveDiscountPercentage);
        Assert.False(item.HasDatedDiscountName);

        // ---- skipped for this year: off, with the manual discounts as they were ----
        var skipped = await catalog.SetDatedDiscountSkipAsync(new SetDatedDiscountSkipRequest { Id = running.Id, Skip = true }, headers: auth, cancellationToken: cts.Token);
        Assert.False(skipped.ActiveToday);
        Assert.Equal("10", (await Item(plain)).EffectivePrice);
        Assert.Equal("9.00", (await Item(manualSmaller)).EffectivePrice);

        await catalog.SetDatedDiscountSkipAsync(new SetDatedDiscountSkipRequest { Id = running.Id, Skip = false }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal("7.00", (await Item(plain)).EffectivePrice);

        // ---- moved to dates that haven't come yet: back to normal, and listed as upcoming ----
        var later = Request(0.3, DateTime.UtcNow.Date.AddDays(10), DateTime.UtcNow.Date.AddDays(12), plain);
        later.Id = running.Id;
        var moved = await catalog.SaveDatedDiscountAsync(later, headers: auth, cancellationToken: cts.Token);
        Assert.False(moved.ActiveToday);
        Assert.InRange(moved.DaysUntilNext, 9, 11);
        Assert.Equal([plain], moved.Skus);
        Assert.Equal("10", (await Item(plain)).EffectivePrice);
        Assert.Equal("9.00", (await Item(manualSmaller)).EffectivePrice); // no longer in it at all

        // ---- refused: bad percentage, dates the wrong way round, an item that doesn't exist ----
        async Task<StatusCode> StatusOf(SaveDatedDiscountRequest request) =>
            (await Assert.ThrowsAsync<RpcException>(async () => await catalog.SaveDatedDiscountAsync(request, headers: auth, cancellationToken: cts.Token))).StatusCode;

        Assert.Equal(StatusCode.InvalidArgument, await StatusOf(Request(1.2, yesterday, tomorrow, plain)));
        Assert.Equal(StatusCode.InvalidArgument, await StatusOf(Request(0.3, tomorrow, yesterday, plain)));
        Assert.Equal(StatusCode.NotFound, await StatusOf(Request(0.3, yesterday, tomorrow, $"NO-SUCH-{Guid.NewGuid():N}")));

        // ---- deleted: gone from the list ----
        await catalog.DeleteDatedDiscountAsync(new DeleteDatedDiscountRequest { Id = running.Id }, headers: auth, cancellationToken: cts.Token);
        var listed = await catalog.ListDatedDiscountsAsync(new ListDatedDiscountsRequest(), headers: auth, cancellationToken: cts.Token);
        Assert.DoesNotContain(listed.DatedDiscounts, d => d.Id == running.Id);
    }
}
