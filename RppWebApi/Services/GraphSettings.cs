namespace RppWebApi.Services;

/// <summary>
/// Microsoft Graph integration settings (EO-407).
/// Configured per installation via the "Graph" section in appsettings / environment,
/// so no team or organisation identifiers live in code.
/// </summary>
public class GraphSettings
{
    public const string SectionName = "Graph";

    /// <summary>
    /// Entra ID group id of the M365 team whose members are planned in RPP.
    ///
    /// EO-428: this is deployment configuration and must stay empty in committed files. It is no
    /// longer a fallback for requests that arrive without team context — substituting a team the
    /// caller may not belong to is what produced a permission error for a legitimate user on
    /// 2026-07-26. A request with no resolvable team is now reported as such.
    /// </summary>
    public string TeamGroupId { get; set; } = string.Empty;

    /// <summary>
    /// Display name used for memberships when no per-team mapping exists yet. Deployment
    /// configuration; no tenant-specific default belongs here (BR-200.x).
    /// </summary>
    public string TeamName { get; set; } = string.Empty;
}
