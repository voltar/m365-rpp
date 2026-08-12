using RppWebApi.Data;
using Xunit;

namespace RppWebApi.Tests;

public class PostgresDateTimeTests
{
    [Fact]
    public void AsUtcDate_UnspecifiedJsonDate_BecomesUtcMidnight()
    {
        var input = new DateTime(2026, 11, 13, 0, 0, 0, DateTimeKind.Unspecified);

        var result = PostgresDateTime.AsUtcDate(input);

        Assert.Equal(DateTimeKind.Utc, result.Kind);
        Assert.Equal(new DateTime(2026, 11, 13, 0, 0, 0, DateTimeKind.Utc), result);
    }

    [Fact]
    public void AsUtcInstant_Unspecified_BecomesUtc()
    {
        var input = new DateTime(2026, 7, 22, 8, 42, 0, DateTimeKind.Unspecified);

        var result = PostgresDateTime.AsUtcInstant(input);

        Assert.Equal(DateTimeKind.Utc, result.Kind);
        Assert.Equal(2026, result.Year);
        Assert.Equal(7, result.Month);
        Assert.Equal(22, result.Day);
    }
}
