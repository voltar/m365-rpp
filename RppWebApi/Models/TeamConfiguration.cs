namespace RppWebApi.Models;

/// <summary>
/// Team configuration entity (TeamPlanningConfiguration from EO-101)
/// </summary>
public class TeamConfiguration
{
    public string Id { get; set; } = string.Empty;
    public string TeamId { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;
    public string DefaultApproverId { get; set; } = string.Empty;
    public string? BackupApproverId { get; set; }
    public bool ApprovalRequired { get; set; } = true;
    public bool OutlookSyncEnabled { get; set; } = true;
    public string? Comment { get; set; }
    public DateTime LastModified { get; set; } = DateTime.UtcNow;
}