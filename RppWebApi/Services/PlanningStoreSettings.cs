namespace RppWebApi.Services;

/// <summary>
/// EO-430 FR-430.2 / EO-458: which persistence profile this installation runs (ADR-002 / ADR-007).
/// </summary>
public enum PlanningStoreProvider
{
    /// <summary>Microsoft SQL Server / Azure SQL via EF Core. Relational scaling tier.</summary>
    Sql,

    /// <summary>PostgreSQL via EF Core. Same relational tier, portable Linux/Host Europe friendly engine (ADR-007).</summary>
    Postgres,

    /// <summary>SharePoint Online lists in the customer's tenant. The entry tier.</summary>
    SharePoint,

    /// <summary>In-memory data for demonstration and development. Not a persistence profile.</summary>
    Mock
}

/// <summary>
/// EO-430 FR-430.2: the resolved persistence profile, registered as a singleton so components can
/// report or branch on it. A holder rather than the bare enum because
/// <c>AddSingleton&lt;T&gt;(T instance)</c> constrains <c>T</c> to a reference type.
/// </summary>
public sealed class PlanningStoreSelection
{
    public PlanningStoreSelection(PlanningStoreProvider provider)
    {
        Provider = provider;
    }

    public PlanningStoreProvider Provider { get; }

    /// <summary>Lower-case name for logs, health responses and diagnostics.</summary>
    public string Name => Provider.ToString().ToLowerInvariant();

    /// <summary>True when EF Core + a relational database backs planning (SQL Server or PostgreSQL).</summary>
    public bool IsRelational => Provider is PlanningStoreProvider.Sql or PlanningStoreProvider.Postgres;
}

/// <summary>
/// EO-430 FR-430.2 / EO-458: store selection for the planning repository.
///
/// The value is deployment configuration (ADR-002 / ADR-007) and is resolved at startup. It is
/// deliberately not defaulted in code: an unknown or missing value fails startup rather than
/// silently binding a store the operator did not choose. The shipped <c>appsettings.json</c>
/// carries <c>"Provider": "sql"</c>, so an installation that does not think about this keeps its
/// previous behaviour, and a value that has been removed or mistyped is reported instead of guessed.
/// </summary>
public class PlanningStoreSettings
{
    public const string SectionName = "Planning";

    /// <summary>Raw configured value. Parsed by <see cref="Parse"/>.</summary>
    public string Provider { get; set; } = string.Empty;

    /// <summary>
    /// Resolves the configured value to a provider.
    /// </summary>
    /// <exception cref="PlanningStoreConfigurationException">
    /// The value is missing, empty, or not one of the supported providers.
    /// </exception>
    public static PlanningStoreProvider Parse(string? configuredValue)
    {
        if (string.IsNullOrWhiteSpace(configuredValue))
        {
            throw new PlanningStoreConfigurationException(
                $"No planning store configured. Set '{SectionName}:Provider' to one of: {SupportedValues}. " +
                "This value selects the persistence profile (ADR-002) and has no default.");
        }

        var trimmed = configuredValue.Trim();

        // EO-458: accept common aliases so App Settings / compose files can say postgresql or npgsql.
        if (string.Equals(trimmed, "postgresql", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "npgsql", StringComparison.OrdinalIgnoreCase))
        {
            return PlanningStoreProvider.Postgres;
        }

        if (string.Equals(trimmed, "sqlserver", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "mssql", StringComparison.OrdinalIgnoreCase))
        {
            return PlanningStoreProvider.Sql;
        }

        foreach (var candidate in Enum.GetValues<PlanningStoreProvider>())
        {
            if (string.Equals(candidate.ToString(), trimmed, StringComparison.OrdinalIgnoreCase))
            {
                return candidate;
            }
        }

        throw new PlanningStoreConfigurationException(
            $"Unknown planning store '{trimmed}' in '{SectionName}:Provider'. Supported values: {SupportedValues}.");
    }

    /// <summary>Comma-separated list of accepted values, for error messages and diagnostics.</summary>
    public static string SupportedValues =>
        string.Join(", ", Enum.GetValues<PlanningStoreProvider>().Select(value => value.ToString().ToLowerInvariant()))
        + " (aliases: postgresql, npgsql → postgres; sqlserver, mssql → sql)";
}

/// <summary>
/// EO-430 FR-430.2: raised at startup when the planning store is not configured or not recognised.
/// Named so the failure is identifiable in logs rather than surfacing as a generic startup error.
/// </summary>
public class PlanningStoreConfigurationException : Exception
{
    public PlanningStoreConfigurationException(string message)
        : base(message)
    {
    }
}
