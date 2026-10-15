using Microsoft.Extensions.Configuration;

namespace Microsoft.Extensions.Hosting;

// The shop's own clock. "Today" for a dated discount, and which day a sale counts towards in a
// report, are both calendar days where the shop is — not where the server happens to run.
// One place for it, so every service draws the line at the same midnight.
public static class ShopTime
{
    // Shop:TimeZone is an IANA id. An unknown one falls back to UTC rather than failing whatever
    // asked (a price lookup, a report).
    public static TimeZoneInfo Zone(IConfiguration configuration)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(configuration["Shop:TimeZone"] ?? "Europe/Athens");
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>The shop's wall-clock time at that instant.</summary>
    public static DateTime Local(IConfiguration configuration, DateTimeOffset instant) =>
        TimeZoneInfo.ConvertTime(instant, Zone(configuration)).DateTime;

    /// <summary>The shop's calendar day at that instant.</summary>
    public static DateOnly DayOf(IConfiguration configuration, DateTimeOffset instant) =>
        DateOnly.FromDateTime(Local(configuration, instant));
}
