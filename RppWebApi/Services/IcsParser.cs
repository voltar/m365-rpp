using System.Globalization;
using System.Text.RegularExpressions;

namespace RppWebApi.Services;

/// <summary>
/// EO-424: RFC 5545 iCalendar (.ics) parser for inbound Outlook mailbox sync.
/// Extracts the fields needed to create or update an RPP absence record.
/// </summary>
public static class IcsParser
{
    private static readonly Regex KeyValueRegex = new(
        @"^(?<key>[A-Za-z-]+?)(;(?<params>[^:]*))?:(?<value>.*)$",
        RegexOptions.Multiline | RegexOptions.Compiled);

    private static readonly Regex PropertyParamRegex = new(
        @"(?<name>[^=;]+)=(?<value>[^;]+)",
        RegexOptions.Compiled);

    /// <summary>
    /// Parsed iCalendar event data extracted from a .ics attachment.
    /// </summary>
    public sealed class IcsEvent
    {
        /// <summary>RFC 5545 UID — unique event identifier used for update/cancel matching.</summary>
        public string? Uid { get; init; }

        /// <summary>iCalendar METHOD (PUBLISH, REQUEST, CANCEL, etc.).</summary>
        public string? Method { get; init; }

        /// <summary>Event subject / title (SUMMARY property).</summary>
        public string? Summary { get; init; }

        /// <summary>Event description (DESCRIPTION property).</summary>
        public string? Description { get; init; }

        /// <summary>Start date/time. For all-day events this is a date-only value.</summary>
        public DateTime? Start { get; init; }

        /// <summary>End date/time. For all-day events this is the exclusive end date.</summary>
        public DateTime? End { get; init; }

        /// <summary>True if DTSTART has no TIME component (all-day event).</summary>
        public bool IsAllDay { get; init; }

        /// <summary>Organizer email address extracted from ORGANIZER property.</summary>
        public string? OrganizerEmail { get; init; }

        /// <summary>Organizer display name extracted from ORGANIZER CN parameter.</summary>
        public string? OrganizerName { get; init; }
    }

    /// <summary>
    /// Parses raw .ics file content into a structured <see cref="IcsEvent"/>.
    /// Returns null if the content is not a valid iCalendar object or contains
    /// no VEVENT component.
    /// </summary>
    public static IcsEvent? Parse(string icsContent)
    {
        if (string.IsNullOrWhiteSpace(icsContent))
            return null;

        // Normalize line endings and unfold folded lines (RFC 5545 §3.1)
        var normalized = icsContent
            .Replace("\r\n", "\n")
            .Replace("\r", "\n");
        normalized = Regex.Replace(normalized, @"\n[ \t]", "");

        // Extract METHOD from VCALENDAR level
        var method = ExtractPropertyValue(normalized, "METHOD");

        // Find the first VEVENT block
        var veventMatch = Regex.Match(normalized, @"BEGIN:VEVENT\n(?<body>.*?)\nEND:VEVENT", RegexOptions.Singleline);
        if (!veventMatch.Success)
            return null;

        var veventBody = veventMatch.Groups["body"].Value;

        var uid = ExtractPropertyValue(veventBody, "UID");
        var summary = UnescapeText(ExtractPropertyValue(veventBody, "SUMMARY"));
        var description = UnescapeText(ExtractPropertyValue(veventBody, "DESCRIPTION"));

        // Parse DTSTART / DTEND
        var dtStartRaw = ExtractPropertyValue(veventBody, "DTSTART");
        var dtEndRaw = ExtractPropertyValue(veventBody, "DTEND");

        var (start, isAllDay) = ParseDateTime(dtStartRaw);
        var (end, _) = ParseDateTime(dtEndRaw);

        // Extract organizer
        var organizerRaw = ExtractPropertyWithParams(veventBody, "ORGANIZER");
        var organizerEmail = ExtractOrganizerEmail(organizerRaw.value);
        var organizerName = organizerRaw.parameters.TryGetValue("CN", out var cn) ? UnescapeText(cn) : null;

        if (uid is null || start is null || end is null)
            return null;

        return new IcsEvent
        {
            Uid = uid,
            Method = method,
            Summary = summary,
            Description = description,
            Start = start.Value,
            End = end.Value,
            IsAllDay = isAllDay,
            OrganizerEmail = organizerEmail,
            OrganizerName = organizerName
        };
    }

    /// <summary>
    /// Extracts a simple property value (e.g. "UID:abc123@domain" → "abc123@domain").
    /// </summary>
    private static string? ExtractPropertyValue(string content, string propertyName)
    {
        var match = Regex.Match(content, $@"^{Regex.Escape(propertyName)}(;[^:]*)?:(?<value>.*)$", RegexOptions.Multiline);
        return match.Success ? match.Groups["value"].Value.Trim() : null;
    }

    /// <summary>
    /// Extracts a property value along with its parameters.
    /// Returns (value, parameters dictionary).
    /// </summary>
    private static (string? value, Dictionary<string, string> parameters) ExtractPropertyWithParams(
        string content, string propertyName)
    {
        var match = Regex.Match(content, $@"^{Regex.Escape(propertyName)}(;(?<params>[^:]*))?:(?<value>.*)$", RegexOptions.Multiline);
        if (!match.Success)
            return (null, new Dictionary<string, string>());

        var value = match.Groups["value"].Value.Trim();
        var paramsStr = match.Groups["params"].Value;
        var parameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrEmpty(paramsStr))
        {
            var paramMatches = PropertyParamRegex.Matches(paramsStr);
            foreach (Match pm in paramMatches)
            {
                var name = pm.Groups["name"].Value;
                var val = pm.Groups["value"].Value;
                parameters[name] = val;
            }
        }

        return (value, parameters);
    }

    /// <summary>
    /// Extracts the email address from an ORGANIZER value.
    /// Handles "mailto:user@domain.com" and "CN=Name:mailto:user@domain.com" formats.
    /// </summary>
    private static string? ExtractOrganizerEmail(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        // Handle "mailto:user@domain.com"
        var mailtoIndex = raw.LastIndexOf("mailto:", StringComparison.OrdinalIgnoreCase);
        if (mailtoIndex >= 0)
        {
            var email = raw[(mailtoIndex + 7)..].Trim();
            // Remove any trailing parameters
            var semicolonIndex = email.IndexOf(';');
            return semicolonIndex >= 0 ? email[..semicolonIndex].Trim() : email;
        }

        // Plain email without mailto: prefix
        if (raw.Contains('@'))
            return raw.Trim();

        return null;
    }

    /// <summary>
    /// Parses an iCalendar date or date-time value.
    /// Returns (DateTime, isAllDay).
    /// </summary>
    private static (DateTime? date, bool isAllDay) ParseDateTime(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return (null, false);

        // Date-only: YYYYMMDD (8 chars)
        if (raw.Length == 8 && DateTime.TryParseExact(raw, "yyyyMMdd",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateOnly))
        {
            return (dateOnly, true);
        }

        // Date-time: YYYYMMDDTHHMMSS[Z]
        var cleaned = raw.TrimEnd('Z');
        if (DateTime.TryParseExact(cleaned, "yyyyMMddTHHmmss",
                CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dateTime))
        {
            return (dateTime, false);
        }

        return (null, false);
    }

    /// <summary>
    /// Un-escapes iCalendar text values (\, \; \n \\ → , ; newline \).
    /// </summary>
    private static string? UnescapeText(string? value)
    {
        if (value is null)
            return null;

        return value
            .Replace("\\,", ",")
            .Replace("\\;", ";")
            .Replace("\\n", "\n")
            .Replace("\\\\", "\\");
    }
}
