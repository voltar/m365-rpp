using System;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>
/// EO-424: the inbound sync originally accepted calendar data only as a file attachment named
/// *.ics. That rejected the action the EO's user story describes - forwarding an appointment out
/// of Outlook - because Exchange delivers that as a meeting request whose calendar data is the
/// message itself, with hasAttachments false and an empty attachments collection.
///
/// These tests pin the shapes the extractor has to survive, one per sender behaviour we know of.
/// </summary>
public class MimeCalendarExtractorTests
{
    private const string PlainCalendar =
        "BEGIN:VCALENDAR\r\n" +
        "METHOD:REQUEST\r\n" +
        "BEGIN:VEVENT\r\n" +
        "UID:abc-123\r\n" +
        "SUMMARY:Ferien\r\n" +
        "END:VEVENT\r\n" +
        "END:VCALENDAR\r\n";

    [Fact]
    public void Extract_ReturnsNull_ForEmptyInput()
    {
        Assert.Null(MimeCalendarExtractor.Extract(null));
        Assert.Null(MimeCalendarExtractor.Extract(""));
        Assert.Null(MimeCalendarExtractor.Extract("   "));
    }

    [Fact]
    public void Extract_ReturnsNull_WhenMessageCarriesNoCalendarPart()
    {
        var mime =
            "Content-Type: multipart/alternative; boundary=\"sep\"\r\n" +
            "\r\n" +
            "--sep\r\n" +
            "Content-Type: text/plain; charset=\"utf-8\"\r\n" +
            "\r\n" +
            "Bin naechste Woche weg.\r\n" +
            "--sep--\r\n";

        Assert.Null(MimeCalendarExtractor.Extract(mime));
    }

    [Fact]
    public void Extract_FindsCalendarPart_InSinglePartMessage()
    {
        var mime =
            "Content-Type: text/calendar; charset=\"utf-8\"; method=REQUEST\r\n" +
            "Content-Transfer-Encoding: 7bit\r\n" +
            "\r\n" +
            PlainCalendar;

        var result = MimeCalendarExtractor.Extract(mime);

        Assert.NotNull(result);
        Assert.Contains("UID:abc-123", result);
    }

    /// <summary>
    /// The Exchange meeting-request shape: a multipart body whose last part is the calendar,
    /// base64-encoded. This is what an appointment forwarded from Outlook looks like.
    /// </summary>
    [Fact]
    public void Extract_DecodesBase64CalendarPart_InMultipartMessage()
    {
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(PlainCalendar));

        var mime =
            "Content-Type: multipart/alternative; boundary=\"sep\"\r\n" +
            "\r\n" +
            "--sep\r\n" +
            "Content-Type: text/html; charset=\"utf-8\"\r\n" +
            "\r\n" +
            "<html><body>Ferien</body></html>\r\n" +
            "--sep\r\n" +
            "Content-Type: text/calendar; charset=\"utf-8\"; method=REQUEST\r\n" +
            "Content-Transfer-Encoding: base64\r\n" +
            "\r\n" +
            encoded + "\r\n" +
            "--sep--\r\n";

        var result = MimeCalendarExtractor.Extract(mime);

        Assert.NotNull(result);
        Assert.Contains("BEGIN:VEVENT", result);
        Assert.Contains("UID:abc-123", result);
    }

    [Fact]
    public void Extract_DecodesQuotedPrintableCalendarPart()
    {
        var mime =
            "Content-Type: multipart/mixed; boundary=\"sep\"\r\n" +
            "\r\n" +
            "--sep\r\n" +
            "Content-Type: text/calendar; charset=\"utf-8\"\r\n" +
            "Content-Transfer-Encoding: quoted-printable\r\n" +
            "\r\n" +
            "BEGIN:VCALENDAR\r\n" +
            "BEGIN:VEVENT\r\n" +
            "UID:abc-123\r\n" +
            "SUMMARY:Ferien in Z=C3=BCrich\r\n" +
            "END:VEVENT\r\n" +
            "END:VCALENDAR\r\n" +
            "--sep--\r\n";

        var result = MimeCalendarExtractor.Extract(mime);

        Assert.NotNull(result);
        Assert.Contains("Ferien in Zürich", result);
    }

    /// <summary>
    /// A part may declare text/calendar and still not carry a calendar - the extractor keeps
    /// scanning rather than returning the first near-miss.
    /// </summary>
    [Fact]
    public void Extract_SkipsCalendarPartWithoutVCalendar_AndKeepsScanning()
    {
        var mime =
            "Content-Type: multipart/mixed; boundary=\"sep\"\r\n" +
            "\r\n" +
            "--sep\r\n" +
            "Content-Type: text/calendar; charset=\"utf-8\"\r\n" +
            "\r\n" +
            "not a calendar at all\r\n" +
            "--sep\r\n" +
            "Content-Type: text/calendar; charset=\"utf-8\"\r\n" +
            "\r\n" +
            PlainCalendar +
            "--sep--\r\n";

        var result = MimeCalendarExtractor.Extract(mime);

        Assert.NotNull(result);
        Assert.Contains("UID:abc-123", result);
    }
}
