using InventorySystem.Catalog.Api.Data;

namespace InventorySystem.Catalog.Api.Services;

public record Occurrence(DateOnly Start, DateOnly End);

// The date arithmetic for dated discounts, kept free of the database and the clock so it can be
// tested with plain dates. A period's stored dates are its first occurrence; every later one is
// the same span moved forward whole years (29 February falls back to the 28th in other years).
// Nothing applies before the first occurrence.
public static class DatedDiscountSchedule
{
    public static Occurrence OccurrenceOf(DatedDiscountPeriod period, int yearsLater)
    {
        var start = period.StartDate.AddYears(yearsLater);
        return new Occurrence(start, start.AddDays(period.EndDate.DayNumber - period.StartDate.DayNumber));
    }

    public static bool IsActive(DatedDiscount discount, DateOnly today) =>
        discount.Periods.Any(period => Occurrences(period, today).Any(o =>
            o.Start <= today && today <= o.End && o.Start.Year != discount.SkippedYear));

    // The occurrence running today, otherwise the next one still to come — ignoring a skipped
    // year. Null only for a discount with no periods.
    public static Occurrence? CurrentOrNext(DatedDiscount discount, DateOnly today) =>
        discount.Periods
            .SelectMany(period => Occurrences(period, today))
            .Where(o => o.End >= today && o.Start.Year != discount.SkippedYear)
            .OrderBy(o => o.Start)
            .Cast<Occurrence?>()
            .FirstOrDefault();

    // The most recent occurrence that has fully passed (skipped or not is not recorded per
    // occurrence, so a skipped year still counts as a date it was due).
    public static Occurrence? Last(DatedDiscount discount, DateOnly today) =>
        discount.Periods
            .SelectMany(period => Occurrences(period, today))
            .Where(o => o.End < today)
            .OrderByDescending(o => o.Start)
            .Cast<Occurrence?>()
            .FirstOrDefault();

    // Every occurrence that could matter relative to today: from the year before (a span that
    // started last December can still be running) to three years on (far enough to find the next
    // one past a skipped year).
    private static IEnumerable<Occurrence> Occurrences(DatedDiscountPeriod period, DateOnly today)
    {
        var first = Math.Max(0, today.Year - period.StartDate.Year - 1);
        var last = Math.Max(first, today.Year - period.StartDate.Year + 3);
        for (var yearsLater = first; yearsLater <= last; yearsLater++)
            yield return OccurrenceOf(period, yearsLater);
    }
}
