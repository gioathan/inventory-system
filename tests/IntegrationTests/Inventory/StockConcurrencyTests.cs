using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;

namespace InventorySystem.IntegrationTests.Inventory;

// Spins up the real AppHost (real Postgres container, real Inventory.Api process) and hits
// it over HTTP, so a pass here proves the atomic-update guard holds against an actual
// database under actual concurrent requests — not just against an in-memory fake.
public class StockConcurrencyTests
{
    [Fact]
    public async Task ConcurrentDecrements_NeverOversell_EvenUnderRace()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));

        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>();
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("inventory-api", cts.Token);

        var client = app.CreateHttpClient("inventory-api");

        // Postgres persists across runs via WithDataVolume (intentional, for local dev), so
        // tests share that same data across runs too — a unique SKU per run keeps this test
        // independent of whatever quantity a previous run left the row at.
        var sku = $"CONCURRENCY-TEST-SKU-{Guid.NewGuid():N}";
        const int startingQuantity = 10;
        const int concurrentRequests = 20;

        await client.PostAsJsonAsync("/stock", new { Sku = sku, InitialQuantity = startingQuantity }, cts.Token);

        // Fire all requests at once via Task.WhenAll rather than one at a time — the whole
        // point is to give the database many overlapping decrements on the same row.
        var responses = await Task.WhenAll(Enumerable.Range(0, concurrentRequests)
            .Select(_ => client.PostAsJsonAsync($"/stock/{sku}/adjust", new { Delta = -1 }, cts.Token)));

        var succeeded = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        var rejected = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);

        Assert.Equal(startingQuantity, succeeded);
        Assert.Equal(concurrentRequests - startingQuantity, rejected);

        var final = await client.GetFromJsonAsync<StockResponse>($"/stock/{sku}", cts.Token);
        Assert.Equal(0, final!.QuantityOnHand);
    }

    private record StockResponse(string Sku, int QuantityOnHand);
}
