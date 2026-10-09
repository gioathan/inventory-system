namespace InventorySystem.Catalog.Api.Data;

// A discount that applies by itself on chosen dates and comes round again every year until it's
// deleted — a name-day sale, the week before Christmas. Separate from Item.DiscountPercentage
// (the manual discount an admin switches on and off by hand), which it never touches: on a day
// both apply, the bigger one sets the price, and when the dates pass the item is simply back to
// whatever it had before.
public class DatedDiscount
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public double Percentage { get; set; } // strictly between 0 and 1, like Item.DiscountPercentage
    public List<DatedDiscountPeriod> Periods { get; set; } = [];
    public List<DatedDiscountItem> Items { get; set; } = [];

    // "Not this year": occurrences that start in this calendar year don't apply. One year only,
    // so skipping can never quietly become permanent.
    public int? SkippedYear { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

// One run of days, both ends included (a single day has Start == End). Stored as the dates of
// its first occurrence; later years are derived (see DatedDiscountSchedule), never written back.
public class DatedDiscountPeriod
{
    public Guid Id { get; set; }
    public Guid DatedDiscountId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
}

// By Sku, the item's identity everywhere else in the system (Inventory, labels, the ledger).
public class DatedDiscountItem
{
    public Guid DatedDiscountId { get; set; }
    public required string Sku { get; set; }
}
