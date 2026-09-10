using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using StackExchange.Redis;

namespace InventorySystem.IntegrationTests.ScanGateway;

// Proves the cache-aside logic in CatalogApiClient actually writes to Redis, by connecting
// to Redis directly (bypassing Scan Gateway entirely) and inspecting the key it should have
// populated — not just trusting that the scan endpoint returned the right JSON.
public class ScanCachingTests
{
    [Fact]
    public async Task Scan_OnCacheMiss_PopulatesRedisWithTheResolvedItem()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));

        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>();
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("scan-gateway", cts.Token);

        var catalog = app.CreateHttpClient("catalog-api");
        var scanGateway = app.CreateHttpClient("scan-gateway");

        var sku = $"CACHE-TEST-{Guid.NewGuid():N}";
        var barcode = Random.Shared.NextInt64(100000000000, 999999999999).ToString();

        await catalog.PostAsJsonAsync("/items", new { Sku = sku, Name = "Cache Test Item", Barcode = barcode }, cts.Token);

        var scanResponse = await scanGateway.GetAsync($"/scan/{barcode}", cts.Token);
        scanResponse.EnsureSuccessStatusCode();

        var redisConnectionString = await app.GetConnectionStringAsync("redis", cts.Token);
        await using var redis = await ConnectionMultiplexer.ConnectAsync(redisConnectionString!);
        var db = redis.GetDatabase();

        var cacheKey = $"catalog-item:{barcode}";
        var exists = await db.KeyExistsAsync(cacheKey);
        var ttl = await db.KeyTimeToLiveAsync(cacheKey);

        Assert.True(exists, $"Expected Redis to contain a cache entry for key '{cacheKey}' after a scan.");
        Assert.True(ttl is { } t && t > TimeSpan.Zero && t <= TimeSpan.FromMinutes(5), $"Expected a positive TTL of at most 5 minutes, got {ttl}.");
    }
}
