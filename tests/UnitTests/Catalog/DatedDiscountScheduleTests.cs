using InventorySystem.Catalog.Api.Data;
using InventorySystem.Catalog.Api.Services;

namespace InventorySystem.UnitTests.Catalog;

// The yearly-repeat arithmetic behind dated discounts, with plain dates — no database, no clock.
public class DatedDiscountScheduleTests
{
    private static DateOnly D(int year, int month, int day) => new(year, month, day);

    private static DatedDiscount Discount(int? skippedYear = null, params (DateOnly Start, DateOnly End)[] periods) => new()
    {
        Id = Guid.NewGuid(),
        Name = "Test",
        Percentage = 0.2,
        SkippedYear = skippedYear,
        Periods = periods.Select(p => new DatedDiscountPeriod { Id = Guid.NewGuid(), StartDate = p.Start, EndDate = p.End }).ToList()
    };

    [Fact]
    public void ASingleDay_IsActiveOnlyOnThatDay()
    {
        var discount = Discount(null, (D(2026, 10, 20), D(2026, 10, 20)));

        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2026, 10, 19)));
        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2026, 10, 20)));
        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2026, 10, 21)));
    }

    [Fact]
    public void ItComesRoundOnTheSameDatesEveryYear_ButNeverBeforeTheFirstOnes()
    {
        var discount = Discount(null, (D(2026, 12, 24), D(2026, 12, 26)));

        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2027, 12, 25)));
        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2031, 12, 24)));
        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2027, 12, 27)));
        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2025, 12, 25))); // the year before it was set
    }

    [Fact]
    public void ARangeOverNewYear_KeepsRunningIntoJanuary()
    {
        var discount = Discount(null, (D(2026, 12, 30), D(2027, 1, 2)));

        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2026, 12, 31)));
        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2027, 1, 2)));
        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2027, 1, 3)));
        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2028, 1, 1))); // the 2027 occurrence
    }

    [Fact]
    public void The29thOfFebruary_FallsOnThe28thInOtherYears()
    {
        var discount = Discount(null, (D(2028, 2, 29), D(2028, 2, 29)));

        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2029, 2, 28)));
        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2029, 3, 1)));
        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2032, 2, 29)));
    }

    [Fact]
    public void SeveralPeriods_AreEachActive_AndTheNextOneIsTheSoonest()
    {
        var discount = Discount(null, (D(2026, 10, 20), D(2026, 10, 20)), (D(2026, 12, 24), D(2026, 12, 26)));

        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2026, 12, 25)));
        Assert.Equal(new Occurrence(D(2026, 12, 24), D(2026, 12, 26)), DatedDiscountSchedule.CurrentOrNext(discount, D(2026, 11, 1)));
        Assert.Equal(new Occurrence(D(2027, 10, 20), D(2027, 10, 20)), DatedDiscountSchedule.CurrentOrNext(discount, D(2026, 12, 27)));
    }

    [Fact]
    public void CurrentOrNext_IsTheRunningOccurrence_ThenNextYearsOnceItHasPassed()
    {
        var discount = Discount(null, (D(2026, 10, 20), D(2026, 10, 22)));

        Assert.Equal(new Occurrence(D(2026, 10, 20), D(2026, 10, 22)), DatedDiscountSchedule.CurrentOrNext(discount, D(2026, 10, 1)));
        Assert.Equal(new Occurrence(D(2026, 10, 20), D(2026, 10, 22)), DatedDiscountSchedule.CurrentOrNext(discount, D(2026, 10, 22)));
        Assert.Equal(new Occurrence(D(2027, 10, 20), D(2027, 10, 22)), DatedDiscountSchedule.CurrentOrNext(discount, D(2026, 10, 23)));
    }

    [Fact]
    public void Last_IsTheMostRecentOccurrenceThatHasPassed_AndNothingBeforeTheFirst()
    {
        var discount = Discount(null, (D(2026, 10, 20), D(2026, 10, 22)));

        Assert.Null(DatedDiscountSchedule.Last(discount, D(2026, 10, 21)));
        Assert.Equal(new Occurrence(D(2026, 10, 20), D(2026, 10, 22)), DatedDiscountSchedule.Last(discount, D(2027, 6, 1)));
        Assert.Equal(new Occurrence(D(2027, 10, 20), D(2027, 10, 22)), DatedDiscountSchedule.Last(discount, D(2027, 10, 23)));
    }

    [Fact]
    public void ASkippedYear_TurnsOffThatYearsOccurrenceOnly()
    {
        var discount = Discount(2027, (D(2026, 10, 20), D(2026, 10, 20)));

        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2026, 10, 20)));
        Assert.False(DatedDiscountSchedule.IsActive(discount, D(2027, 10, 20)));
        Assert.True(DatedDiscountSchedule.IsActive(discount, D(2028, 10, 20)));
        Assert.Equal(new Occurrence(D(2028, 10, 20), D(2028, 10, 20)), DatedDiscountSchedule.CurrentOrNext(discount, D(2027, 1, 1)));
    }
}
