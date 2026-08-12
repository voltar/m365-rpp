using System.Collections.Generic;

namespace RppWebApi.Models;

/// <summary>
/// Team Admin Center transfer objects (EO-408 persistence layer).
/// Shapes mirror the frontend TeamAdminDetails contracts in
/// src/features/team-admin/types/teamSettings.ts.
/// </summary>
public class TeamAdminTeamSummaryDto
{
    public string TeamId { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;
    public string Organization { get; set; } = "Organisation-A";
    public int SortOrder { get; set; }
    public int RequiredStaffing { get; set; }
    public string? Color { get; set; } // EO-423 palette key
    public bool CanManage { get; set; } = true;
    public int MemberCount { get; set; }
    public string TeamLeadUserId { get; set; } = string.Empty;
    public string DefaultApproverUserId { get; set; } = string.Empty;
    public string? BackupApproverUserId { get; set; }
    public bool AllowUserOverride { get; set; } = true;
    public string OutlookSyncPolicy { get; set; } = "optional";
}

public class TeamAdminMemberDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PrimaryTeamId { get; set; } = string.Empty;
    public List<string> AdditionalTeamIds { get; set; } = new();
    public decimal? EmploymentPercentage { get; set; }
    public decimal VacationBalance { get; set; } = 25;
    public int ActiveVacationRequests { get; set; }
    public bool ApprovalExempt { get; set; }
    public string? EffectiveApproverUserId { get; set; }
}

public class TeamAdminDetailsDto
{
    public TeamAdminTeamSummaryDto Team { get; set; } = new();
    public List<TeamAdminPersonDto> AllowedApprovers { get; set; } = new();
    public List<TeamAdminMemberDto> Members { get; set; } = new();
    public List<TeamAdminMemberDto> AssignableMembers { get; set; } = new();
    public List<TeamAdminAbsenceEntryTypeDto> AbsenceEntryTypes { get; set; } = new();
    public List<TeamAdminTeamOptionDto> TeamOptions { get; set; } = new();
    public bool CanEdit { get; set; } = true;
}

public class TeamAdminPersonDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}

public class TeamAdminAbsenceEntryTypeDto
{
    public string Key { get; set; } = string.Empty;
    public string? Label { get; set; }
    public string? LabelKey { get; set; }
    public bool Active { get; set; } = true;
    public bool RequiresApproval { get; set; } = true;
    public bool ConsumesVacationBalance { get; set; }
}

public class TeamAdminTeamOptionDto
{
    public string TeamId { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;
}

/// <summary>Request body for PATCH /api/planning/teamadmin/details.</summary>
public class TeamAdminSaveRequestDto
{
    /// <summary>Team id or "__all-teams" for member/absence-type-only saves.</summary>
    public string TeamId { get; set; } = string.Empty;
    public TeamAdminSettingsPatchDto? Settings { get; set; }
    public List<TeamAdminMemberAssignmentPatchDto> MemberAssignments { get; set; } = new();
    public List<TeamAdminAbsenceEntryTypeDto>? AbsenceEntryTypes { get; set; }
}

public class TeamAdminSettingsPatchDto
{
    public string TeamLeadUserId { get; set; } = string.Empty;
    public string DefaultApproverUserId { get; set; } = string.Empty;
    public string? BackupApproverUserId { get; set; }
    public bool AllowUserOverride { get; set; } = true;
    public string OutlookSyncPolicy { get; set; } = "optional";
}

public class TeamAdminMemberAssignmentPatchDto
{
    public string UserId { get; set; } = string.Empty;
    public string PrimaryTeamId { get; set; } = string.Empty;
    public List<string> AdditionalTeamIds { get; set; } = new();
    public bool ApprovalExempt { get; set; }
    public decimal? EmploymentPercentage { get; set; }
    public decimal VacationBalance { get; set; } = 25;
    public string? EffectiveApproverUserId { get; set; }
}

/// <summary>Request body for POST /api/planning/teamadmin/teams.</summary>
public class TeamCreateRequestDto
{
    /// <summary>Active M365 Team context used for owner authorization (EO-418).</summary>
    public string? SourceTeamId { get; set; }
    public string TeamName { get; set; } = string.Empty;
    public string Organization { get; set; } = "Organisation-A";
}

/// <summary>Request body for PATCH /api/planning/teamadmin/teams (bulk rename/reorder/organisation/staffing).</summary>
public class TeamsUpdateRequestDto
{
    public List<TeamRowDto> Teams { get; set; } = new();
}

public class TeamRowDto
{
    public string TeamId { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;
    public string Organization { get; set; } = "Organisation-A";
    public int SortOrder { get; set; }
    public int RequiredStaffing { get; set; }
    public string? Color { get; set; } // EO-423 palette key
}
