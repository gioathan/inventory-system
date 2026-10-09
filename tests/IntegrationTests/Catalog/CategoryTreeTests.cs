using Aspire.Hosting.Testing;
using global::Grpc.Core;
using InventorySystem.Grpc.Contracts.Catalog;
using InventorySystem.IntegrationTests.TestHelpers;

namespace InventorySystem.IntegrationTests.Catalog;

// The category tree's rules, against the real Catalog.Api over gRPC (same setup as
// CatalogItemTests): sub-categories, unique names, the nesting limit, and "items go in
// categories with no sub-categories" — including the grace for items already in a category
// that later gains some.
public class CategoryTreeTests
{
    [Fact]
    public async Task Categories_NestUnderAParent_AndItemsOnlyGoInOnesWithNoSubcategories()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("catalog-api", cts.Token);

        var auth = AuthTestHelper.BearerHeaders(await app.LoginAsAdminAsync(cts.Token));
        var catalog = app.CreateCatalogGrpcClient();
        var run = Guid.NewGuid().ToString("N")[..8];

        Task<CategoryReply> Create(string name, string? parentId = null)
        {
            var request = new CreateCategoryRequest { Name = name };
            if (parentId is not null)
                request.ParentId = parentId;
            return catalog.CreateCategoryAsync(request, headers: auth, cancellationToken: cts.Token).ResponseAsync;
        }

        async Task<StatusCode> StatusOf(Func<Task> call) =>
            (await Assert.ThrowsAsync<RpcException>(call)).StatusCode;

        // ---- a top-level category holding an item, before it has any sub-categories ----
        var jewelry = await Create($"Jewelry {run}");
        Assert.False(jewelry.HasParentId);

        var sku = $"CATEGORY-TREE-{Guid.NewGuid():N}";
        await catalog.CreateItemAsync(
            new CreateItemRequest { Name = "Ring", Sku = sku, Price = "10", CategoryId = jewelry.Id },
            headers: auth, cancellationToken: cts.Token);

        // ---- sub-categories; names are unique across the whole tree ----
        var earrings = await Create($"Earrings {run}", jewelry.Id);
        Assert.Equal(jewelry.Id, earrings.ParentId);
        Assert.Equal(StatusCode.AlreadyExists, await StatusOf(() => Create($"Earrings {run}")));
        Assert.Equal(StatusCode.AlreadyExists, await StatusOf(() => Create($"Jewelry {run}", earrings.Id)));
        Assert.Equal(StatusCode.InvalidArgument, await StatusOf(() => Create($"Orphan {run}", Guid.NewGuid().ToString())));

        var listed = await catalog.ListCategoriesAsync(new ListCategoriesRequest(), headers: auth, cancellationToken: cts.Token);
        Assert.Equal(jewelry.Id, listed.Categories.Single(c => c.Id == earrings.Id).ParentId);

        // ---- the parent no longer takes items: not new ones, not moved ones ----
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(async () =>
            await catalog.CreateItemAsync(
                new CreateItemRequest { Name = "Necklace", Price = "10", CategoryId = jewelry.Id },
                headers: auth, cancellationToken: cts.Token)));

        var intoParent = new MoveItemsToCategoryRequest { CategoryId = jewelry.Id };
        intoParent.Skus.Add(sku);
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(async () =>
            await catalog.MoveItemsToCategoryAsync(intoParent, headers: auth, cancellationToken: cts.Token)));

        // ---- but the item already there stays put and stays editable until it's sorted ----
        var stillThere = await catalog.GetItemBySkuAsync(new GetItemBySkuRequest { Sku = sku }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(jewelry.Id, stillThere.CategoryId);

        var edited = await catalog.UpdateItemAsync(
            new UpdateItemRequest { Sku = sku, Name = "Ring", Price = "12", Barcode = stillThere.Barcode, CategoryId = jewelry.Id },
            headers: auth, cancellationToken: cts.Token);
        Assert.Equal("12", edited.Price);

        // ---- sorting it into the sub-category ----
        var intoChild = new MoveItemsToCategoryRequest { CategoryId = earrings.Id };
        intoChild.Skus.Add(sku);
        var moved = await catalog.MoveItemsToCategoryAsync(intoChild, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(earrings.Id, Assert.Single(moved.Items).CategoryId);

        var unknownSku = new MoveItemsToCategoryRequest { CategoryId = earrings.Id };
        unknownSku.Skus.Add($"NO-SUCH-{Guid.NewGuid():N}");
        Assert.Equal(StatusCode.NotFound, await StatusOf(async () =>
            await catalog.MoveItemsToCategoryAsync(unknownSku, headers: auth, cancellationToken: cts.Token)));

        // ---- nesting stops at five levels: Jewelry > Earrings > L3 > L4 > L5, and no L6 ----
        var parent = earrings.Id;
        for (var level = 3; level <= 5; level++)
            parent = (await Create($"L{level} {run}", parent)).Id;
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(() => Create($"L6 {run}", parent)));
    }

    [Fact]
    public async Task Categories_CanBeRenamedMovedAndDeleted_WithinTheTreesRules()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
        var appHost = await DistributedApplicationTestingBuilder.CreateAsync<Projects.InventorySystem_AppHost>(["--Web:Enabled=false"]);
        await using var app = await appHost.BuildAsync(cts.Token);
        await app.StartAsync(cts.Token);
        await app.ResourceNotifications.WaitForResourceHealthyAsync("catalog-api", cts.Token);

        var auth = AuthTestHelper.BearerHeaders(await app.LoginAsAdminAsync(cts.Token));
        var catalog = app.CreateCatalogGrpcClient();
        var run = Guid.NewGuid().ToString("N")[..8];

        async Task<CategoryReply> Create(string name, string? parentId = null)
        {
            var request = new CreateCategoryRequest { Name = name };
            if (parentId is not null)
                request.ParentId = parentId;
            return await catalog.CreateCategoryAsync(request, headers: auth, cancellationToken: cts.Token);
        }

        async Task<CategoryReply> Move(string id, string? parentId)
        {
            var request = new MoveCategoryRequest { Id = id };
            if (parentId is not null)
                request.ParentId = parentId;
            return await catalog.MoveCategoryAsync(request, headers: auth, cancellationToken: cts.Token);
        }

        async Task Delete(string id) =>
            await catalog.DeleteCategoryAsync(new DeleteCategoryRequest { Id = id }, headers: auth, cancellationToken: cts.Token);

        async Task<StatusCode> StatusOf(Func<Task> call) =>
            (await Assert.ThrowsAsync<RpcException>(call)).StatusCode;

        // A > B > C, plus an unrelated top-level D.
        var a = await Create($"A {run}");
        var b = await Create($"B {run}", a.Id);
        var c = await Create($"C {run}", b.Id);
        var d = await Create($"D {run}");

        // ---- rename: unique across the tree, and renaming to its own name is not a clash ----
        var renamed = await catalog.RenameCategoryAsync(new RenameCategoryRequest { Id = b.Id, Name = $"B2 {run}" }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal($"B2 {run}", renamed.Name);
        Assert.Equal(a.Id, renamed.ParentId); // renaming doesn't move it
        await catalog.RenameCategoryAsync(new RenameCategoryRequest { Id = b.Id, Name = $"B2 {run}" }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(StatusCode.AlreadyExists, await StatusOf(async () =>
            await catalog.RenameCategoryAsync(new RenameCategoryRequest { Id = b.Id, Name = $"D {run}" }, headers: auth, cancellationToken: cts.Token)));
        Assert.Equal(StatusCode.NotFound, await StatusOf(async () =>
            await catalog.RenameCategoryAsync(new RenameCategoryRequest { Id = Guid.NewGuid().ToString(), Name = $"X {run}" }, headers: auth, cancellationToken: cts.Token)));

        // ---- move: never into itself or anything beneath it ----
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(() => Move(a.Id, a.Id)));
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(() => Move(a.Id, c.Id)));
        Assert.Equal(StatusCode.InvalidArgument, await StatusOf(() => Move(a.Id, Guid.NewGuid().ToString())));

        // ---- move: the whole branch must still fit the five-level limit ----
        var e = await Create($"E {run}", d.Id);
        var f = await Create($"F {run}", e.Id);                                                   // D > E > F: F is at level 3
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(() => Move(a.Id, f.Id)));      // 3 + A's three levels = 6
        Assert.Equal(e.Id, (await Move(b.Id, e.Id)).ParentId);                                    // D > E > B2 > C = 4: fine
        Assert.False((await Move(b.Id, null)).HasParentId);                                       // and out to the top level

        // ---- delete: only once it has no sub-categories and no items ----
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(() => Delete(b.Id)));          // still holds C

        var sku = $"CATEGORY-DELETE-{Guid.NewGuid():N}";
        await catalog.CreateItemAsync(new CreateItemRequest { Name = "Held", Sku = sku, Price = "1", CategoryId = c.Id }, headers: auth, cancellationToken: cts.Token);
        Assert.Equal(StatusCode.FailedPrecondition, await StatusOf(() => Delete(c.Id)));          // holds an item

        var clear = new MoveItemsToCategoryRequest();
        clear.Skus.Add(sku);
        await catalog.MoveItemsToCategoryAsync(clear, headers: auth, cancellationToken: cts.Token);

        await Delete(c.Id);
        await Delete(b.Id);
        Assert.Equal(StatusCode.NotFound, await StatusOf(() => Delete(b.Id)));

        var remaining = await catalog.ListCategoriesAsync(new ListCategoriesRequest(), headers: auth, cancellationToken: cts.Token);
        Assert.DoesNotContain(remaining.Categories, x => x.Id == b.Id || x.Id == c.Id);
    }
}
