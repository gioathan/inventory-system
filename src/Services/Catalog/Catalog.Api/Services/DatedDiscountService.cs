using InventorySystem.Catalog.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Catalog.Api.Services;

public record ActiveDatedDiscount(double Percentage, string Name);

// Answers "which dated discount, if any, applies to this item today". Evaluated when a price is
// read rather than switched on and off by a background job at midnight: there is no job to fail
// and leave a sale running, or not started.
public class DatedDiscountService(CatalogDbContext db, IConfiguration configuration, TimeProvider clock)
{
    // The shop's calendar day, not the server's: a discount for 20 October starts at midnight
    // where the shop is. Shop:TimeZone is an IANA id; an unknown one falls back to UTC rather
    // than failing every price lookup.
    public DateOnly Today()
    {
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(configuration["Shop:TimeZone"] ?? "Europe/Athens");
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            zone = TimeZoneInfo.Utc;
        }
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
    }

    // Per Sku, the biggest dated discount running today. All of them are loaded and filtered in
    // memory: there are a handful, and "is today inside a yearly-repeating span" isn't something
    // worth teaching SQL.
    public async Task<Dictionary<string, ActiveDatedDiscount>> GetActiveBySkuAsync(CancellationToken cancellationToken)
    {
        var today = Today();
        var discounts = await db.DatedDiscounts.AsNoTracking()
            .Include(d => d.Periods).Include(d => d.Items)
            .ToListAsync(cancellationToken);

        var active = new Dictionary<string, ActiveDatedDiscount>();
        foreach (var discount in discounts.Where(d => DatedDiscountSchedule.IsActive(d, today)))
        {
            foreach (var item in discount.Items)
            {
                if (!active.TryGetValue(item.Sku, out var current) || discount.Percentage > current.Percentage)
                    active[item.Sku] = new ActiveDatedDiscount(discount.Percentage, discount.Name);
            }
        }
        return active;
    }
}
