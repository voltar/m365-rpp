using System.Globalization;
using System.Text;

namespace RppWebApi.Services;

/// <summary>
/// Builds the Microsoft Approvals title/description shown in the Teams Approvals app.
/// Dates and day-halves are localized; the raw ISO/API tokens (fullDay, 2026-11-13) stay internal.
/// </summary>
public static class ApprovalRequestText
{
    public static (string Title, string Description) Build(
        string userDisplayName,
        string startDate,
        string startHalf,
        string endDate,
        string endHalf,
        string? commentToApprover,
        string? comment,
        string requestId,
        CultureInfo culture)
    {
        var isGerman = culture.TwoLetterISOLanguageName.Equals("de", StringComparison.OrdinalIgnoreCase);
        var startLabel = FormatDateHalf(startDate, startHalf, culture, isGerman);
        var endLabel = FormatDateHalf(endDate, endHalf, culture, isGerman);
        var period = string.Equals(startLabel, endLabel, StringComparison.Ordinal)
            ? startLabel
            : $"{startLabel} – {endLabel}";

        var title = isGerman
            ? $"Ferienantrag – {userDisplayName} ({period})"
            : $"Vacation request – {userDisplayName} ({period})";

        var remark = string.IsNullOrWhiteSpace(commentToApprover)
            ? (string.IsNullOrWhiteSpace(comment) ? "–" : comment.Trim())
            : commentToApprover.Trim();

        var description = new StringBuilder();
        if (isGerman)
        {
            description.AppendLine($"Antragsteller: {userDisplayName}");
            description.AppendLine($"Zeitraum: {period}");
            description.AppendLine($"Kommentar: {remark}");
        }
        else
        {
            description.AppendLine($"Requester: {userDisplayName}");
            description.AppendLine($"Period: {period}");
            description.AppendLine($"Comment: {remark}");
        }

        // Keep the machine id for support, but after the human-readable fields.
        description.AppendLine($"RequestId: {requestId}");

        return (title, description.ToString().TrimEnd());
    }

    /// <summary>
    /// Resolves culture from Accept-Language (Teams/browser). Defaults to de-CH for the
    /// primary deployment audience when the header is missing or unsupported.
    /// </summary>
    public static CultureInfo ResolveCulture(string? acceptLanguageHeader)
    {
        if (!string.IsNullOrWhiteSpace(acceptLanguageHeader))
        {
            foreach (var segment in acceptLanguageHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var tag = segment.Split(';', 2)[0].Trim();
                if (tag.Length == 0 || tag == "*")
                {
                    continue;
                }

                try
                {
                    var culture = CultureInfo.GetCultureInfo(tag);
                    if (culture.TwoLetterISOLanguageName is "de" or "en")
                    {
                        // Prefer Swiss German date style when the tag is bare "de".
                        if (culture.TwoLetterISOLanguageName == "de"
                            && (culture.Name.Equals("de", StringComparison.OrdinalIgnoreCase)
                                || culture.Name.StartsWith("de-DE", StringComparison.OrdinalIgnoreCase)))
                        {
                            return CultureInfo.GetCultureInfo("de-CH");
                        }

                        return culture;
                    }
                }
                catch (CultureNotFoundException)
                {
                    // try next tag
                }
            }
        }

        return CultureInfo.GetCultureInfo("de-CH");
    }

    internal static string FormatDateHalf(string rawDate, string? dayHalf, CultureInfo culture, bool isGerman)
    {
        var dateText = FormatDate(rawDate, culture);
        var halfText = FormatDayHalf(dayHalf, isGerman);

        return halfText is null ? dateText : $"{dateText} ({halfText})";
    }

    internal static string FormatDate(string rawDate, CultureInfo culture)
    {
        if (DateOnly.TryParse(rawDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateOnly))
        {
            // de-CH / de: 13.11.2026 — en: 13 Nov 2026
            return culture.TwoLetterISOLanguageName.Equals("en", StringComparison.OrdinalIgnoreCase)
                ? dateOnly.ToString("d MMM yyyy", culture)
                : dateOnly.ToString("dd.MM.yyyy", culture);
        }

        if (DateTime.TryParse(rawDate, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dateTime))
        {
            return culture.TwoLetterISOLanguageName.Equals("en", StringComparison.OrdinalIgnoreCase)
                ? dateTime.ToString("d MMM yyyy", culture)
                : dateTime.ToString("dd.MM.yyyy", culture);
        }

        return rawDate;
    }

    /// <summary>
    /// Returns null for full-day so the period stays compact ("13.11.2026 – 16.11.2026").
    /// Half days are labeled in parentheses.
    /// </summary>
    internal static string? FormatDayHalf(string? dayHalf, bool isGerman)
    {
        if (string.IsNullOrWhiteSpace(dayHalf)
            || dayHalf.Equals("fullDay", StringComparison.OrdinalIgnoreCase)
            || dayHalf.Equals("full", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (dayHalf.Equals("morning", StringComparison.OrdinalIgnoreCase))
        {
            return isGerman ? "Vormittag" : "Morning";
        }

        if (dayHalf.Equals("afternoon", StringComparison.OrdinalIgnoreCase))
        {
            return isGerman ? "Nachmittag" : "Afternoon";
        }

        return dayHalf;
    }
}
