namespace RppWebApi.Services;

/// <summary>
/// EO-424: Configuration for the inbound Outlook mailbox sync.
/// </summary>
public class MailboxSyncSettings
{
    public const string SectionName = "MailboxSync";

    /// <summary>Master switch. When false, no Graph calls are made.</summary>
    public bool Enabled { get; set; }

    /// <summary>The shared mailbox email address (e.g. "AbsencesRPP@tenant.org").</summary>
    public string MailboxAddress { get; set; } = string.Empty;

    /// <summary>Cron expression for scheduled polling. Default: 08:00, 12:00, 16:00.</summary>
    public string CronExpression { get; set; } = "0 8,12,16 * * *";

    /// <summary>Maximum number of unread messages to process per poll cycle.</summary>
    public int BatchSize { get; set; } = 50;

    /// <summary>Default absence type when no keyword match is found in the subject.</summary>
    public string DefaultAbsenceType { get; set; } = "vacation";

    /// <summary>
    /// Keyword-to-absence-type mapping table. Keys are lowercase subject substrings,
    /// values are RPP absence types. Matched case-insensitively against the event
    /// SUMMARY. First match wins. If no keyword matches, the raw SUMMARY text is
    /// used as the type (1:1 fallback).
    /// </summary>
    public Dictionary<string, string> TypeKeywords { get; set; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ferien"] = "vacation",
        ["urlaub"] = "vacation",
        ["vacation"] = "vacation",
        ["holiday"] = "vacation",
        ["krank"] = "sick",
        ["krankheit"] = "sick",
        ["sick"] = "sick",
        ["illness"] = "sick",
        ["home office"] = "homeOffice",
        ["homeoffice"] = "homeOffice",
        ["remote"] = "homeOffice",
        ["weiterbildung"] = "training",
        ["training"] = "training",
        ["kurs"] = "training",
        ["course"] = "training",
        ["kompensation"] = "compensation",
        ["compensation"] = "compensation",
        ["überzeit"] = "compensation",
        ["militär"] = "military",
        ["military"] = "military",
        ["wk"] = "military",
        ["wiederholungskurs"] = "military",
        ["ausbildung"] = "education",
        ["education"] = "education",
        ["unbezahlt"] = "unpaidLeave",
        ["unpaid"] = "unpaidLeave",
    };

    /// <summary>Business hours start (HH:mm) for half-day detection on timed events.</summary>
    public string BusinessHoursStart { get; set; } = "08:00";

    /// <summary>Business hours end (HH:mm) for half-day detection on timed events.</summary>
    public string BusinessHoursEnd { get; set; } = "17:00";
}
