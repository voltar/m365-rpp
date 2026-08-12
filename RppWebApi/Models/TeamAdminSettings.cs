using System;
using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// Team-specific settings (approvers, policy). One-to-one with TeamAdminTeam.
/// Part of normalized Team Admin persistence (EO-408).
/// </summary>
public class TeamAdminSettings
{
    [Key]
    [MaxLength(50)]
    public string TeamId { get; set; } = string.Empty;

    [MaxLength(100)]
    public string TeamLeadUserId { get; set; } = string.Empty;

    [MaxLength(100)]
    public string DefaultApproverUserId { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? BackupApproverUserId { get; set; }

    [MaxLength(20)]
    public string ApprovalPolicy { get; set; } = "optional"; // "optional" | "mandatory" | "disabled"

    [MaxLength(20)]
    public string OutlookSyncPolicy { get; set; } = "optional"; // "optional" | "mandatory" | "disabled"

    public bool AllowUserOverride { get; set; } = true;

    public bool OutlookSyncEnabled { get; set; } = true;

    public DateTime LastModified { get; set; } = DateTime.UtcNow;

    public TeamAdminTeam Team { get; set; } = null!;
}
