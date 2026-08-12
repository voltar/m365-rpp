using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// Normalized Team entity for Team Admin Center (EO-408).
/// Replaces previous localStorage-based team records.
/// Supports configurable organisations and multiple teams.
/// </summary>
public class TeamAdminTeam
{
    [Key]
    [MaxLength(50)]
    public string TeamId { get; set; } = string.Empty;

    [MaxLength(200)]
    public string TeamName { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Organization { get; set; } = ""; // EO-415 configurable

    // EO-419: internal teams belong to one M365 Team (host context); Team Admin
    // only shows and edits teams owned by the active host team.
    [MaxLength(100)]
    public string OwningTeamId { get; set; } = string.Empty;

    public int SortOrder { get; set; } = 0;

    public int RequiredStaffing { get; set; } = 0;

    // EO-423: palette color key assigned in the Team Admin Center (e.g. "blue");
    // null = automatic (deterministic client-side fallback from the team name).
    [MaxLength(30)]
    public string? Color { get; set; }

    public bool CanManage { get; set; } = true;

    public DateTime LastModified { get; set; } = DateTime.UtcNow;

    // Navigation properties for normalized relationships
    public ICollection<TeamAdminMemberAssignment> MemberAssignments { get; set; } = new List<TeamAdminMemberAssignment>();
    public TeamAdminSettings? Settings { get; set; }
}
