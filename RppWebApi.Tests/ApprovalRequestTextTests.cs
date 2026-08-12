using System.Globalization;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

public class GraphApprovalUrlTests
{
    [Theory]
    [InlineData("https://graph.microsoft.com/beta/solutions/approval/operations/abc", "https://graph.microsoft.com/beta/solutions/approval/operations/abc")]
    [InlineData("/beta/solutions/approval/operations/abc", "https://graph.microsoft.com/beta/solutions/approval/operations/abc")]
    [InlineData("beta/solutions/approval/operations/abc", "https://graph.microsoft.com/beta/solutions/approval/operations/abc")]
    [InlineData(null, null)]
    [InlineData("", null)]
    public void ToAbsoluteGraphUrl_ExpandsRelativeLocations(string? input, string? expected)
    {
        Assert.Equal(expected, GraphApprovalService.ToAbsoluteGraphUrl(input));
    }
}

public class ApprovalRequestTextTests
{
    [Fact]
    public void Build_German_FormatsDatesAndOmitsFullDayToken()
    {
        var culture = CultureInfo.GetCultureInfo("de-CH");

        var (title, description) = ApprovalRequestText.Build(
            userDisplayName: "Alex Mueller",
            startDate: "2026-11-13",
            startHalf: "fullDay",
            endDate: "2026-11-16",
            endHalf: "fullDay",
            commentToApprover: "Runder Geburtstag",
            comment: null,
            requestId: "vacation-request-1",
            culture: culture);

        Assert.Equal("Ferienantrag – Alex Mueller (13.11.2026 – 16.11.2026)", title);
        Assert.Contains("Zeitraum: 13.11.2026 – 16.11.2026", description);
        Assert.DoesNotContain("fullDay", description);
        Assert.DoesNotContain("2026-11-13", description);
        Assert.Contains("Kommentar: Runder Geburtstag", description);
        Assert.Contains("RequestId: vacation-request-1", description);
    }

    [Fact]
    public void Build_German_IncludesLocalizedHalfDays()
    {
        var culture = CultureInfo.GetCultureInfo("de-CH");

        var (title, description) = ApprovalRequestText.Build(
            userDisplayName: "Anne Keller",
            startDate: "2026-08-20",
            startHalf: "morning",
            endDate: "2026-08-20",
            endHalf: "afternoon",
            commentToApprover: null,
            comment: null,
            requestId: "vacation-request-2",
            culture: culture);

        Assert.Equal("Ferienantrag – Anne Keller (20.08.2026 (Vormittag) – 20.08.2026 (Nachmittag))", title);
        Assert.Contains("Vormittag", description);
        Assert.Contains("Nachmittag", description);
        Assert.DoesNotContain("morning", description);
    }

    [Fact]
    public void Build_English_FormatsDatesAndLabels()
    {
        var culture = CultureInfo.GetCultureInfo("en-GB");

        var (title, description) = ApprovalRequestText.Build(
            userDisplayName: "Anne Keller",
            startDate: "2026-11-13",
            startHalf: "fullDay",
            endDate: "2026-11-16",
            endHalf: "fullDay",
            commentToApprover: "Birthday",
            comment: null,
            requestId: "vacation-request-3",
            culture: culture);

        Assert.StartsWith("Vacation request – Anne Keller (", title);
        Assert.Contains("13 Nov 2026", title);
        Assert.Contains("16 Nov 2026", title);
        Assert.Contains("Period:", description);
        Assert.Contains("Comment: Birthday", description);
        Assert.DoesNotContain("fullDay", description);
    }

    [Theory]
    [InlineData("de-CH", "de-CH")]
    [InlineData("de", "de-CH")]
    [InlineData("de-DE,de;q=0.9,en;q=0.8", "de-CH")]
    [InlineData("en-GB", "en-GB")]
    [InlineData("en-US,en;q=0.9", "en-US")]
    [InlineData("", "de-CH")]
    [InlineData(null, "de-CH")]
    public void ResolveCulture_UsesAcceptLanguageWithGermanDefault(string? header, string expectedName)
    {
        var culture = ApprovalRequestText.ResolveCulture(header);
        Assert.Equal(expectedName, culture.Name);
    }
}
