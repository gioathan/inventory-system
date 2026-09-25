using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Inventory;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Inventory;

// Spins up the real AppHost (real Postgres container, real Inventory.Api process) and hits
// it over gRPC (the only surface for adjust/get-stock now — see TECH_DEBT.md), so a pass here
// proves the atomic-update guard holds against an actual database under actual concurrent
// requests — not just against an in-memory fake.
public class StockConcurrencyTests
{
    [Fact]
    public async Task ConcurrentDecrements_NeverOversell_EvenUnderRace()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));

        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("inventory-api", cts.Token);

        // POST /stock is the one REST route Inventory.Api kept — nothing over gRPC covers
        // "create a stock row directly at an exact quantity, failing if one already exists,"
        // which is exactly the clean-fixture behavior this test needs.
        var client = app.CreateHttpClient("inventory-api");
        var inventory = app.CreateInventoryGrpcClient();

        // Step 9: every endpoint now requires a valid JWT.
        var token = await app.LoginAsAdminAsync(cts.Token);
        client.UseBearerToken(token);
        var auth = AuthTestHelper.BearerHeaders(token);

        // Postgres persists across runs via WithDataVolume (intentional, for local dev), so
        // tests share that same data across runs too — a unique SKU per run keeps this test
        // independent of whatever quantity a previous run left the row at.
        var sku = $"CONCURRENCY-TEST-SKU-{Guid.NewGuid():N}";
        const int startingQuantity = 10;
        const int concurrentRequests = 20;

        await client.PostAsJsonAsync("/stock", new { Sku = sku, InitialQuantity = startingQuantity }, cts.Token);

        // Fire all requests at once via Task.WhenAll rather than one at a time — the whole
        // point is to give the database many overlapping decrements on the same row.
        var results = await Task.WhenAll(Enumerable.Range(0, concurrentRequests).Select(async _ =>
        {
            try
            {
                await inventory.AdjustStockAsync(
                    new AdjustStockRequest { Sku = sku, Delta = -1, Reason = MovementReason.ManualAdjust },
                    headers: auth, cancellationToken: cts.Token);
                return true;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.FailedPrecondition)
            {
                return false;
            }
        }));

        var succeeded = results.Count(r => r);
        var rejected = results.Count(r => !r);

        Assert.Equal(startingQuantity, succeeded);
        Assert.Equal(concurrentRequests - startingQuantity, rejected);

        var final = await inventory.GetStockAsync(new GetStockRequest { Sku = sku }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(0, final.QuantityOnHand);
    }
}
