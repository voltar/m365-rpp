namespace RppWebApi.Services;

/// <summary>
/// EO-424: text handling for the inbound mailbox sync — the two places where values written by
/// other mail clients meet the constraints of this system.
/// </summary>
public static class MailboxSyncText
{
    // Column limits of the Absences table. Calendar text is written by people and by foreign mail
    // clients, so none of it can be assumed to fit: a forwarded invitation routinely carries a
    // DESCRIPTION well past 500 characters once joining links and quoted text are appended.
    public const int CommentMaxLength = 500;
    public const int IcsUidMaxLength = 255;
    public const int TypeMaxLength = 50;

    /// <summary>
    /// Shortens a value to what its column accepts. Truncation is deterministic, so a UID shortened
    /// here still matches the same absence on a later update or cancellation.
    /// </summary>
    public static string? Clamp(string? value, int maxLength)
    {
        if (value is null || value.Length <= maxLength)
        {
            return value;
        }

        return value[..maxLength];
    }

    /// <summary>
    /// Flattens an exception chain into one line. EF Core's DbUpdateException says only "See the
    /// inner exception for details" — the column, the constraint and the offending value all live
    /// in the inner SqlException, so reporting the outer message alone told an operator nothing.
    /// </summary>
    public static string Describe(Exception exception)
    {
        var messages = new List<string>();

        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            // Some providers repeat the same text at several levels; saying it once is enough.
            if (!messages.Contains(current.Message))
            {
                messages.Add(current.Message);
            }
        }

        return string.Join(" → ", messages);
    }
}
