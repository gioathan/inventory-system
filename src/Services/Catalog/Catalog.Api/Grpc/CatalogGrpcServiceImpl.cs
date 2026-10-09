using System.Globalization;
using global::Grpc.Core;
using InventorySystem.Auth.Contracts;
using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Services;
using InventorySystem.Grpc.Contracts.Catalog;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Grpc;

// Class-level floor for every RPC; anything that changes the catalog (items, categories,
// discounts) adds a stricter Admin-only policy on top (attributes combine with AND). Reading
// stays at the floor — including ListCategories, which sellers need to filter by category.
[Authorize(Policy = AuthPolicies.SellerOrAdmin)]
public class CatalogGrpcServiceImpl(CatalogDbContext db, ItemCreationService itemCreation, DatedDiscountService datedDiscounts)
    : CatalogGrpcService.CatalogGrpcServiceBase
{
    public override async Task<ItemReply> GetItemByBarcode(GetItemByBarcodeRequest request, ServerCallContext context)
    {
        var item = await db.Items.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Barcode == request.Barcode, context.CancellationToken);

        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item found for barcode '{request.Barcode}'."));

        return (await ItemRepliesAsync(context.CancellationToken))(item);
    }

    public override async Task<ItemReply> GetItemBySku(GetItemBySkuRequest request, ServerCallContext context)
    {
        var item = await db.Items.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Sku == request.Sku, context.CancellationToken);

        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item found for SKU '{request.Sku}'."));

        return (await ItemRepliesAsync(context.CancellationToken))(item);
    }

    public override async Task<ListItemsReply> ListItems(ListItemsRequest request, ServerCallContext context)
    {
        var items = await db.Items.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListItemsReply();
        reply.Items.AddRange(items.Select(await ItemRepliesAsync(context.CancellationToken)));
        return reply;
    }

    // Admin-only, matching Scan Gateway's /items/intake — creating an item also stocks it.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ItemReply> CreateItem(CreateItemRequest request, ServerCallContext context)
    {
        Guid? categoryId = request.HasCategoryId ? ParseCategoryId(request.CategoryId) : null;
        if (categoryId is { } id)
            await RequireAssignableCategoryAsync(id, context.CancellationToken);

        try
        {
            var item = await itemCreation.CreateItemAsync(
                RequireName(request.Name),
                ParsePrice(request.Price),
                request.HasBarcode ? request.Barcode : null,
                request.HasSku ? request.Sku : null,
                categoryId,
                request.HasImageUrl ? request.ImageUrl : null,
                context.CancellationToken);

            return (await ItemRepliesAsync(context.CancellationToken))(item);
        }
        catch (ItemAlreadyExistsException ex)
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, ex.Message));
        }
    }

    // A full replace of the editable fields (see UpdateItemRequest), admin-only like the rest of
    // catalog management (categories, discounts, creating items).
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ItemReply> UpdateItem(UpdateItemRequest request, ServerCallContext context)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Sku == request.Sku, context.CancellationToken);
        if (item is null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item found for SKU '{request.Sku}'."));

        item.Name = RequireName(request.Name);
        item.Price = ParsePrice(request.Price);
        item.Barcode = request.Barcode;
        // Checked only when the category actually changes: an item still sitting directly in a
        // category that has since gained sub-categories (waiting to be sorted) must stay editable
        // — a price change shouldn't fail over where the item happens to be filed.
        Guid? categoryId = request.HasCategoryId ? ParseCategoryId(request.CategoryId) : null;
        if (categoryId is { } id && categoryId != item.CategoryId)
            await RequireAssignableCategoryAsync(id, context.CancellationToken);
        item.CategoryId = categoryId;
        item.ImageUrl = request.HasImageUrl ? request.ImageUrl : null;

        try
        {
            await db.SaveChangesAsync(context.CancellationToken);
        }
        catch (DbUpdateException ex) when (ItemCreationService.IsUniqueViolation(ex))
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Another item already uses barcode '{request.Barcode}'."));
        }

        return (await ItemRepliesAsync(context.CancellationToken))(item);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<CategoryReply> CreateCategory(CreateCategoryRequest request, ServerCallContext context)
    {
        var name = RequireName(request.Name).Trim();

        // Names stay unique across the whole tree, not just among siblings: it keeps "which
        // Earrings?" from ever being a question (CSV import matches categories by name) and
        // means a name can't repeat anywhere along a chain.
        if (await db.Categories.AnyAsync(c => c.Name == name, context.CancellationToken))
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Category '{name}' already exists."));

        Guid? parentId = request.HasParentId ? ParseCategoryId(request.ParentId) : null;
        if (parentId is { } id)
        {
            var depth = await DepthOfAsync(id, context.CancellationToken)
                ?? throw new RpcException(new Status(StatusCode.InvalidArgument, "The parent category doesn't exist."));
            if (depth >= MaxCategoryDepth)
                throw new RpcException(new Status(StatusCode.FailedPrecondition, $"Categories can be nested at most {MaxCategoryDepth} levels deep."));
        }

        // Deliberately allowed even when the parent still holds items of its own: they stay
        // where they are (and keep showing up under the parent) until an admin sorts them into
        // the new sub-categories with MoveItemsToCategory. Moving them automatically would file
        // them all under whichever sub-category happened to be created first.
        var category = new Category { Id = Guid.NewGuid(), Name = name, ParentId = parentId };
        db.Categories.Add(category);
        try
        {
            await db.SaveChangesAsync(context.CancellationToken);
        }
        catch (DbUpdateException ex) when (ItemCreationService.IsUniqueViolation(ex))
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Category '{name}' already exists."));
        }

        return ToReply(category);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<MoveItemsToCategoryReply> MoveItemsToCategory(MoveItemsToCategoryRequest request, ServerCallContext context)
    {
        Guid? categoryId = request.HasCategoryId ? ParseCategoryId(request.CategoryId) : null;
        if (categoryId is { } id)
            await RequireAssignableCategoryAsync(id, context.CancellationToken);

        var items = await LoadItemsOrThrowAsync(request.Skus, context.CancellationToken);
        foreach (var item in items)
            item.CategoryId = categoryId;
        await db.SaveChangesAsync(context.CancellationToken);

        var reply = new MoveItemsToCategoryReply();
        reply.Items.AddRange(items.Select(await ItemRepliesAsync(context.CancellationToken)));
        return reply;
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<CategoryReply> RenameCategory(RenameCategoryRequest request, ServerCallContext context)
    {
        var id = ParseCategoryId(request.Id);
        var name = RequireName(request.Name).Trim();

        var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id, context.CancellationToken)
            ?? throw new RpcException(new Status(StatusCode.NotFound, "That category doesn't exist."));

        if (await db.Categories.AnyAsync(c => c.Name == name && c.Id != id, context.CancellationToken))
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Category '{name}' already exists."));

        category.Name = name;
        try
        {
            await db.SaveChangesAsync(context.CancellationToken);
        }
        catch (DbUpdateException ex) when (ItemCreationService.IsUniqueViolation(ex))
        {
            throw new RpcException(new Status(StatusCode.AlreadyExists, $"Category '{name}' already exists."));
        }

        return ToReply(category);
    }

    // The whole (small) tree is loaded and checked in memory: the two rules here — no loops, and
    // the nesting limit for everything that moves along — are both about the shape of the tree,
    // not about one row.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<CategoryReply> MoveCategory(MoveCategoryRequest request, ServerCallContext context)
    {
        var id = ParseCategoryId(request.Id);
        Guid? newParentId = request.HasParentId ? ParseCategoryId(request.ParentId) : null;

        var all = await db.Categories.ToListAsync(context.CancellationToken);
        var byId = all.ToDictionary(c => c.Id);
        if (!byId.TryGetValue(id, out var category))
            throw new RpcException(new Status(StatusCode.NotFound, "That category doesn't exist."));

        var parentDepth = 0;
        if (newParentId is { } parentId)
        {
            if (!byId.ContainsKey(parentId))
                throw new RpcException(new Status(StatusCode.InvalidArgument, "The category to move it into doesn't exist."));

            // Walk up from the new parent: meeting the category being moved means the new parent
            // is the category itself or sits somewhere beneath it.
            Guid? current = parentId;
            while (current is { } step && parentDepth <= all.Count)
            {
                if (step == id)
                    throw new RpcException(new Status(StatusCode.FailedPrecondition,
                        $"'{category.Name}' can't be moved into itself or into one of its own sub-categories."));
                parentDepth++;
                current = byId.TryGetValue(step, out var ancestor) ? ancestor.ParentId : null;
            }
        }

        if (parentDepth + HeightOf(id, all) > MaxCategoryDepth)
            throw new RpcException(new Status(StatusCode.FailedPrecondition, $"Categories can be nested at most {MaxCategoryDepth} levels deep."));

        // As with CreateCategory, a new parent that holds items of its own keeps them: they
        // become "to sort" rather than being moved or blocking this.
        category.ParentId = newParentId;
        await db.SaveChangesAsync(context.CancellationToken);
        return ToReply(category);
    }

    // 1 for a category with no sub-categories, 2 if its deepest chain is one more level, and so on.
    private static int HeightOf(Guid id, List<Category> all, int guard = 0)
    {
        if (guard > all.Count)
            return guard; // corrupted (looping) data: stop rather than recurse forever
        var children = all.Where(c => c.ParentId == id).ToList();
        return 1 + (children.Count == 0 ? 0 : children.Max(c => HeightOf(c.Id, all, guard + 1)));
    }

    // Refused while anything still depends on it: sub-categories would be orphaned (the foreign
    // key would stop that anyway), and items would be left pointing at a category that's gone.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DeleteCategoryReply> DeleteCategory(DeleteCategoryRequest request, ServerCallContext context)
    {
        var id = ParseCategoryId(request.Id);
        var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id, context.CancellationToken)
            ?? throw new RpcException(new Status(StatusCode.NotFound, "That category doesn't exist."));

        if (await db.Categories.AnyAsync(c => c.ParentId == id, context.CancellationToken))
            throw new RpcException(new Status(StatusCode.FailedPrecondition,
                $"'{category.Name}' has sub-categories. Delete or move them first."));

        var itemCount = await db.Items.CountAsync(i => i.CategoryId == id, context.CancellationToken);
        if (itemCount > 0)
            throw new RpcException(new Status(StatusCode.FailedPrecondition,
                $"'{category.Name}' still has {itemCount} item(s). Move them to another category first."));

        db.Categories.Remove(category);
        await db.SaveChangesAsync(context.CancellationToken);
        return new DeleteCategoryReply();
    }

    // No stricter policy than the class-level floor: sellers filter the Stock screen by category.
    public override async Task<ListCategoriesReply> ListCategories(ListCategoriesRequest request, ServerCallContext context)
    {
        var categories = await db.Categories.AsNoTracking().ToListAsync(context.CancellationToken);

        var reply = new ListCategoriesReply();
        reply.Categories.AddRange(categories.Select(ToReply));
        return reply;
    }

    // Admin-only, same reasoning as categories: a batch price reduction for a "low prices
    // period" sale is admin-managed setup, not a day-to-day seller action.
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DiscountReply> ApplyDiscount(ApplyDiscountRequest request, ServerCallContext context)
    {
        if (request.Percentage <= 0 || request.Percentage >= 1)
            throw new RpcException(new Status(StatusCode.InvalidArgument, "percentage must be strictly between 0 and 1."));

        var items = await LoadItemsOrThrowAsync(request.Skus, context.CancellationToken);

        foreach (var item in items)
            item.DiscountPercentage = request.Percentage;

        await db.SaveChangesAsync(context.CancellationToken);

        var reply = new DiscountReply();
        reply.Items.AddRange(items.Select(await ItemRepliesAsync(context.CancellationToken)));
        return reply;
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DiscountReply> RemoveDiscount(RemoveDiscountRequest request, ServerCallContext context)
    {
        var items = await LoadItemsOrThrowAsync(request.Skus, context.CancellationToken);

        foreach (var item in items)
            item.DiscountPercentage = null;

        await db.SaveChangesAsync(context.CancellationToken);

        var reply = new DiscountReply();
        reply.Items.AddRange(items.Select(await ItemRepliesAsync(context.CancellationToken)));
        return reply;
    }

    // Shared by ApplyDiscount/RemoveDiscount: both are all-or-nothing over the requested SKU
    // list — a typo'd SKU fails the whole call instead of silently discounting a subset.
    private async Task<List<Item>> LoadItemsOrThrowAsync(IReadOnlyCollection<string> skus, CancellationToken cancellationToken)
    {
        var items = await db.Items.Where(i => skus.Contains(i.Sku)).ToListAsync(cancellationToken);

        var missing = skus.Except(items.Select(i => i.Sku)).ToList();
        if (missing.Count > 0)
            throw new RpcException(new Status(StatusCode.NotFound, $"No catalog item(s) found for SKU(s): {string.Join(", ", missing)}"));

        return items;
    }

    // A guard against a runaway chain rather than a product rule — raise it if a real catalog
    // ever needs more.
    private const int MaxCategoryDepth = 5;

    // 1 for a top-level category, 2 for its children, and so on; null if the category doesn't
    // exist. Walks up one parent at a time: the tree is small and shallow (see MaxCategoryDepth),
    // and the bound on the loop means even corrupted data can't spin here.
    private async Task<int?> DepthOfAsync(Guid categoryId, CancellationToken cancellationToken)
    {
        Guid? current = categoryId;
        for (var depth = 0; depth <= MaxCategoryDepth; depth++)
        {
            if (current is not { } id)
                return depth;
            var category = await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
            if (category is null)
                return depth == 0 ? null : depth;
            current = category.ParentId;
        }
        return MaxCategoryDepth + 1;
    }

    // Items live at the ends of the tree: a category that has sub-categories is a grouping, and
    // an item put straight into it would be one nobody has decided the place of. Everything
    // under a parent still shows up under that parent — that's a roll-up when reading, not a
    // reason to file things there.
    private async Task RequireAssignableCategoryAsync(Guid categoryId, CancellationToken cancellationToken)
    {
        var category = await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == categoryId, cancellationToken)
            ?? throw new RpcException(new Status(StatusCode.InvalidArgument, "That category doesn't exist."));

        if (await db.Categories.AnyAsync(c => c.ParentId == categoryId, cancellationToken))
            throw new RpcException(new Status(StatusCode.FailedPrecondition,
                $"'{category.Name}' has sub-categories. Choose one of them instead."));
    }

    // Shared by CreateItem/UpdateItem: malformed input is the caller's mistake, so it comes back
    // as InvalidArgument rather than an unhandled FormatException (a generic Internal error).
    private static string RequireName(string name) =>
        string.IsNullOrWhiteSpace(name)
            ? throw new RpcException(new Status(StatusCode.InvalidArgument, "name is required."))
            : name;

    private static decimal ParsePrice(string value) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var price) && price >= 0
            ? price
            : throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{value}' is not a valid price."));

    private static Guid ParseCategoryId(string value) =>
        Guid.TryParse(value, out var id)
            ? id
            : throw new RpcException(new Status(StatusCode.InvalidArgument, $"'{value}' is not a valid category id."));

    private static CategoryReply ToReply(Category category)
    {
        var reply = new CategoryReply { Id = category.Id.ToString(), Name = category.Name };
        if (category.ParentId is { } parentId)
            reply.ParentId = parentId.ToString();
        return reply;
    }

    // Every item reply goes through here so the price a reader sees is always today's: the
    // dated discounts running today are loaded once per call, then applied per item.
    private async Task<Func<Item, ItemReply>> ItemRepliesAsync(CancellationToken cancellationToken)
    {
        var active = await datedDiscounts.GetActiveBySkuAsync(cancellationToken);
        return item => ToReply(item, active.GetValueOrDefault(item.Sku));
    }

    private static ItemReply ToReply(Item item, ActiveDatedDiscount? dated)
    {
        // The bigger of the manual discount and a dated one running today sets the price; the
        // manual one is reported as it is either way, so removing it still means what it says.
        var datedWins = dated is not null && dated.Percentage >= (item.DiscountPercentage ?? 0);
        var active = datedWins ? dated!.Percentage : item.DiscountPercentage;

        // Rounded to cents: this is what a seller charges and what a sale records as its unit
        // price, so 9.99 at 15% off must be 8.49, not 8.4915.
        var effectivePrice = active is { } discount
            ? decimal.Round(item.Price * (1 - (decimal)discount), 2, MidpointRounding.AwayFromZero)
            : item.Price;

        var reply = new ItemReply
        {
            Sku = item.Sku,
            Name = item.Name,
            Barcode = item.Barcode,
            Price = item.Price.ToString(CultureInfo.InvariantCulture),
            EffectivePrice = effectivePrice.ToString(CultureInfo.InvariantCulture)
        };
        if (item.CategoryId is { } categoryId)
            reply.CategoryId = categoryId.ToString();
        if (item.ImageUrl is not null)
            reply.ImageUrl = item.ImageUrl;
        if (item.DiscountPercentage is { } percentage)
            reply.DiscountPercentage = percentage;
        if (active is { } activePercentage)
            reply.ActiveDiscountPercentage = activePercentage;
        if (datedWins)
            reply.DatedDiscountName = dated!.Name;
        return reply;
    }

    // ---- dated discounts -----------------------------------------------------------------------

    private const int MaxPeriods = 20;
    private const int MaxPeriodDays = 366;
    private const int MaxDatedDiscountItems = 2000;
    private const string DateFormat = "yyyy-MM-dd";

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<ListDatedDiscountsReply> ListDatedDiscounts(ListDatedDiscountsRequest request, ServerCallContext context)
    {
        var discounts = await db.DatedDiscounts.AsNoTracking()
            .Include(d => d.Periods).Include(d => d.Items)
            .OrderBy(d => d.Name)
            .ToListAsync(context.CancellationToken);

        var today = datedDiscounts.Today();
        var reply = new ListDatedDiscountsReply();
        reply.DatedDiscounts.AddRange(discounts.Select(d => ToReply(d, today)));
        return reply;
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DatedDiscountReply> SaveDatedDiscount(SaveDatedDiscountRequest request, ServerCallContext context)
    {
        var name = RequireName(request.Name).Trim();
        if (name.Length > 128)
            throw Invalid("The name can be at most 128 characters.");
        if (request.Percentage <= 0 || request.Percentage >= 1)
            throw Invalid("percentage must be strictly between 0 and 1.");

        if (request.Periods.Count == 0)
            throw Invalid("Choose at least one date.");
        if (request.Periods.Count > MaxPeriods)
            throw Invalid($"At most {MaxPeriods} date ranges are allowed.");
        var periods = request.Periods.Select(p =>
        {
            var start = ParseDate(p.StartDate);
            var end = ParseDate(p.EndDate);
            if (end < start)
                throw Invalid($"A date range can't end ({p.EndDate}) before it starts ({p.StartDate}).");
            // Longer than a year and it would overlap its own next occurrence — at that point it
            // isn't a dated discount any more, it's a permanent one.
            if (end.DayNumber - start.DayNumber >= MaxPeriodDays)
                throw Invalid("A date range can cover at most a year.");
            return (Start: start, End: end);
        }).ToList();

        var skus = request.Skus.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToList();
        if (skus.Count == 0)
            throw Invalid("Choose at least one item.");
        if (skus.Count > MaxDatedDiscountItems)
            throw Invalid($"At most {MaxDatedDiscountItems} items are allowed.");
        await LoadItemsOrThrowAsync(skus, context.CancellationToken);

        DatedDiscount discount;
        if (request.HasId)
        {
            discount = await LoadDatedDiscountAsync(request.Id, context.CancellationToken);
            // Periods carry no identity worth keeping, so they're replaced. Items are diffed:
            // their key is (discount, sku), and removing then re-adding the same key in one save
            // is something the change tracker refuses.
            db.RemoveRange(discount.Periods);
            discount.Periods.Clear();
            discount.Items.RemoveAll(i => !skus.Contains(i.Sku));
        }
        else
        {
            discount = new DatedDiscount { Id = Guid.NewGuid(), Name = name, CreatedAt = DateTimeOffset.UtcNow };
            db.DatedDiscounts.Add(discount);
        }

        discount.Name = name;
        discount.Percentage = request.Percentage;
        foreach (var (start, end) in periods)
        {
            var period = new DatedDiscountPeriod { Id = Guid.NewGuid(), DatedDiscountId = discount.Id, StartDate = start, EndDate = end };
            discount.Periods.Add(period);
            db.Add(period); // explicit: a new Guid key on a tracked parent would otherwise be read as an existing row
        }
        foreach (var sku in skus.Where(sku => discount.Items.All(i => i.Sku != sku)))
        {
            var item = new DatedDiscountItem { DatedDiscountId = discount.Id, Sku = sku };
            discount.Items.Add(item);
            db.Add(item);
        }

        await db.SaveChangesAsync(context.CancellationToken);
        return ToReply(discount, datedDiscounts.Today());
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DatedDiscountReply> SetDatedDiscountSkip(SetDatedDiscountSkipRequest request, ServerCallContext context)
    {
        var discount = await LoadDatedDiscountAsync(request.Id, context.CancellationToken);
        var today = datedDiscounts.Today();

        // Which year to skip is decided with no skip in place, so asking twice is the same as
        // asking once rather than walking a year further each time.
        discount.SkippedYear = null;
        if (request.Skip)
            discount.SkippedYear = DatedDiscountSchedule.CurrentOrNext(discount, today)?.Start.Year;

        await db.SaveChangesAsync(context.CancellationToken);
        return ToReply(discount, today);
    }

    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public override async Task<DeleteDatedDiscountReply> DeleteDatedDiscount(DeleteDatedDiscountRequest request, ServerCallContext context)
    {
        var discount = await LoadDatedDiscountAsync(request.Id, context.CancellationToken);
        db.DatedDiscounts.Remove(discount); // periods and items go with it (cascade)
        await db.SaveChangesAsync(context.CancellationToken);
        return new DeleteDatedDiscountReply();
    }

    private async Task<DatedDiscount> LoadDatedDiscountAsync(string value, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(value, out var id))
            throw Invalid($"'{value}' is not a valid dated discount id.");
        return await db.DatedDiscounts.Include(d => d.Periods).Include(d => d.Items).FirstOrDefaultAsync(d => d.Id == id, cancellationToken)
            ?? throw new RpcException(new Status(StatusCode.NotFound, "That dated discount doesn't exist."));
    }

    private static RpcException Invalid(string message) => new(new Status(StatusCode.InvalidArgument, message));

    private static DateOnly ParseDate(string value) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw Invalid($"'{value}' is not a date in {DateFormat} form.");

    private static DatedDiscountReply ToReply(DatedDiscount discount, DateOnly today)
    {
        var reply = new DatedDiscountReply
        {
            Id = discount.Id.ToString(),
            Name = discount.Name,
            Percentage = discount.Percentage,
            ActiveToday = DatedDiscountSchedule.IsActive(discount, today)
        };
        reply.Periods.AddRange(discount.Periods.OrderBy(p => p.StartDate).Select(p => new DatedDiscountPeriodMessage
        {
            StartDate = p.StartDate.ToString(DateFormat, CultureInfo.InvariantCulture),
            EndDate = p.EndDate.ToString(DateFormat, CultureInfo.InvariantCulture)
        }));
        reply.Skus.AddRange(discount.Items.Select(i => i.Sku).Order());

        if (DatedDiscountSchedule.CurrentOrNext(discount, today) is { } next)
        {
            reply.NextStart = next.Start.ToString(DateFormat, CultureInfo.InvariantCulture);
            reply.NextEnd = next.End.ToString(DateFormat, CultureInfo.InvariantCulture);
            reply.DaysUntilNext = Math.Max(0, next.Start.DayNumber - today.DayNumber);
        }
        // Only occurrences since it was created: one made today with last year's dates never
        // actually ran on them.
        if (DatedDiscountSchedule.Last(discount, today) is { } last && last.End >= DateOnly.FromDateTime(discount.CreatedAt.UtcDateTime))
        {
            reply.LastStart = last.Start.ToString(DateFormat, CultureInfo.InvariantCulture);
            reply.LastEnd = last.End.ToString(DateFormat, CultureInfo.InvariantCulture);
        }
        if (discount.SkippedYear is { } skipped)
            reply.SkippedYear = skipped;
        return reply;
    }
}
