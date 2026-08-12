namespace RppWebApi.Models;

/// <summary>
/// Response model for the /api/health endpoint (used by App Admin Center)
/// </summary>
public class HealthResponse
{
    public string Status { get; set; } = "healthy";
    public string Version { get; set; } = "1.0.0";
    public string? SourceRevision { get; set; }
    public string? BuildTimestamp { get; set; }
    public string Environment { get; set; } = "Production";
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string Message { get; set; } = "RPP Web API is running";
    public bool FrontendCompatible { get; set; } = true;
    public string[] SupportedDataSources { get; set; } = ["api", "mock", "sharepoint"];
    public string? BackendProvider { get; set; }

    /// <summary>
    /// EO-430 FR-430.2: the persistence profile this instance runs (ADR-002) — "sql", "sharepoint"
    /// or "mock". Reported so a deployment can be identified without reading its configuration.
    /// </summary>
    public string? PlanningStore { get; set; }
    public string? DatabaseServerName { get; set; }
    public string? DatabaseName { get; set; }
    public string? WebServerName { get; set; }
}