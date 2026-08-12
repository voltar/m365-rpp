namespace RppWebApi.Services;

/// <summary>
/// EO-430: the day count of an absence or vacation request.
///
/// It is derived from the start and end date and the two day halves, and therefore is a calculated
/// value — never persisted (CLAUDE.md, AGENTS.md). The SharePoint profile computes it on read
/// rather than storing it, for the same reason the vacation balance columns were retired: a stored
/// copy is a number a person can edit in a list to something the application does not agree with.
///
/// One implementation, because two would drift. The inbound mailbox sync (EO-424) and the
/// SharePoint provider both use this.
/// </summary>
public static class AbsenceDuration
{
    /// <summary>A day half that consumes only half of its day.</summary>
    private const string Morning = "morning";
    private const string Afternoon = "afternoon";

    /// <summary>
    /// Days covered by the range, counting both end dates, less half a day for each end that starts
    /// or finishes mid-day. Never less than half a day: an absence that exists at all covers at
    /// least one half-day.
    /// </summary>
    public static decimal Calculate(DateTime startDate, string? startHalf, DateTime endDate, string? endHalf)
    {
        if (endDate.Date < startDate.Date)
        {
            return 0m;
        }

        var totalDays = (endDate.Date - startDate.Date).Days + 1m;

        if (IsHalf(startHalf))
        {
            totalDays -= 0.5m;
        }

        if (IsHalf(endHalf))
        {
            totalDays -= 0.5m;
        }

        return Math.Max(0.5m, totalDays);
    }

    private static bool IsHalf(string? dayHalf) =>
        string.Equals(dayHalf, Morning, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(dayHalf, Afternoon, StringComparison.OrdinalIgnoreCase);
}
