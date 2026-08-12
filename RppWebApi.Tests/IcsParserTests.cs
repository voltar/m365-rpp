using System;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>
/// EO-424: the parser decides which employee an inbound absence belongs to and how long it lasts.
/// Both are silent failures when wrong - a mis-parsed organizer skips the message, a mis-parsed
/// DTEND books one day too many. These tests pin the RFC 5545 details that matter for that.
/// </summary>
public class IcsParserTests
{
    private static string Calendar(string method, string vevent) =>
        "BEGIN:VCALENDAR\r\n" +
        "VERSION:2.0\r\n" +
        $"METHOD:{method}\r\n" +
        "BEGIN:VEVENT\r\n" +
        vevent +
        "END:VEVENT\r\n" +
        "END:VCALENDAR\r\n";

    [Fact]
    public void Parse_ReturnsNull_ForNonCalendarContent()
    {
        Assert.Null(IcsParser.Parse(""));
        Assert.Null(IcsParser.Parse("just some text"));
    }

    [Fact]
    public void Parse_ReturnsNull_WhenUidIsMissing()
    {
        var ics = Calendar("REQUEST",
            "SUMMARY:Ferien\r\n" +
            "DTSTART;VALUE=DATE:20260803\r\n" +
            "DTEND;VALUE=DATE:20260808\r\n");

        Assert.Null(IcsParser.Parse(ics));
    }

    [Fact]
    public void Parse_ReadsAllDayEvent_WithExclusiveEndDate()
    {
        var ics = Calendar("REQUEST",
            "UID:abc-123\r\n" +
            "SUMMARY:Ferien\r\n" +
            "DTSTART;VALUE=DATE:20260803\r\n" +
            "DTEND;VALUE=DATE:20260808\r\n" +
            "ORGANIZER;CN=Anna Muster:mailto:anna.muster@example.org\r\n");

        var result = IcsParser.Parse(ics);

        Assert.NotNull(result);
        Assert.Equal("abc-123", result!.Uid);
        Assert.Equal("REQUEST", result.Method);
        Assert.Equal("Ferien", result.Summary);
        Assert.True(result.IsAllDay);
        Assert.Equal(new DateTime(2026, 8, 3), result.Start);
        // DTEND stays exclusive here; the -1 day adjustment belongs to the caller.
        Assert.Equal(new DateTime(2026, 8, 8), result.End);
        Assert.Equal("anna.muster@example.org", result.OrganizerEmail);
        Assert.Equal("Anna Muster", result.OrganizerName);
    }

    [Fact]
    public void Parse_ReadsTimedEvent_AsNotAllDay()
    {
        var ics = Calendar("REQUEST",
            "UID:abc-124\r\n" +
            "SUMMARY:Arzttermin\r\n" +
            "DTSTART:20260803T130000Z\r\n" +
            "DTEND:20260803T170000Z\r\n" +
            "ORGANIZER:mailto:anna.muster@example.org\r\n");

        var result = IcsParser.Parse(ics);

        Assert.NotNull(result);
        // Only the all-day flag is asserted, not the clock time: the parser reads the UTC value
        // with AssumeUniversal, which yields a local-time DateTime, so the hour depends on the
        // server's time zone. Half-day detection wants exactly that local reading.
        Assert.False(result!.IsAllDay);
        Assert.NotNull(result.Start);
        Assert.NotNull(result.End);
        Assert.Equal("anna.muster@example.org", result.OrganizerEmail);
    }

    [Fact]
    public void Parse_ReadsCancelMethod()
    {
        var ics = Calendar("CANCEL",
            "UID:abc-125\r\n" +
            "SUMMARY:Ferien\r\n" +
            "DTSTART;VALUE=DATE:20260803\r\n" +
            "DTEND;VALUE=DATE:20260808\r\n" +
            "ORGANIZER:mailto:anna.muster@example.org\r\n");

        var result = IcsParser.Parse(ics);

        Assert.NotNull(result);
        Assert.Equal("CANCEL", result!.Method);
    }

    /// <summary>
    /// RFC 5545 §3.1: values longer than 75 octets are folded onto continuation lines that begin
    /// with a space. Exchange folds routinely, so unfolding is not an edge case.
    /// </summary>
    [Fact]
    public void Parse_UnfoldsFoldedLines()
    {
        var ics = Calendar("REQUEST",
            "UID:abc-126\r\n" +
            "SUMMARY:Ferien in den Bergen\r\n" +
            "DESCRIPTION:Erste Zeile die sehr lang ist und deshalb\r\n" +
            " ueber zwei Zeilen laeuft\r\n" +
            "DTSTART;VALUE=DATE:20260803\r\n" +
            "DTEND;VALUE=DATE:20260808\r\n" +
            "ORGANIZER:mailto:anna.muster@example.org\r\n");

        var result = IcsParser.Parse(ics);

        Assert.NotNull(result);
        Assert.Equal("Erste Zeile die sehr lang ist und deshalbueber zwei Zeilen laeuft", result!.Description);
    }

    /// <summary>
    /// A plain appointment forwarded out of Outlook can arrive without ORGANIZER. The parser
    /// reports that as null rather than guessing; the sync service then falls back to the sender.
    /// </summary>
    [Fact]
    public void Parse_ReturnsNullOrganizer_WhenPropertyIsAbsent()
    {
        var ics = Calendar("PUBLISH",
            "UID:abc-127\r\n" +
            "SUMMARY:Ferien\r\n" +
            "DTSTART;VALUE=DATE:20260803\r\n" +
            "DTEND;VALUE=DATE:20260808\r\n");

        var result = IcsParser.Parse(ics);

        Assert.NotNull(result);
        Assert.Null(result!.OrganizerEmail);
    }
}
