namespace RppWebApi.Data;

/// <summary>
/// Npgsql rejects <see cref="DateTimeKind.Unspecified"/> for <c>timestamp with time zone</c>.
/// JSON date-only values ("2026-11-13") deserialize as Unspecified — fine on SQL Server,
/// fatal on PostgreSQL (Host Europe). Normalize before every write.
/// </summary>
internal static class PostgresDateTime
{
    /// <summary>
    /// Calendar dates (start/end of absences and vacation requests): keep the civil date,
    /// store as UTC midnight so the day does not shift across zones.
    /// </summary>
    public static DateTime AsUtcDate(DateTime value)
    {
        var date = value.Date;
        return DateTime.SpecifyKind(date, DateTimeKind.Utc);
    }

    /// <summary>Instants (Created/Modified/DecisionDate): force UTC.</summary>
    public static DateTime AsUtcInstant(DateTime value) =>
        value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };

    public static DateTime? AsUtcInstant(DateTime? value) =>
        value is null ? null : AsUtcInstant(value.Value);
}
