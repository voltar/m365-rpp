using RppWebApi.Models;
using System.Threading.Tasks;

namespace RppWebApi.Services;

/// <summary>
/// Interface mirroring the main planning repository contracts from the frontend.
/// This will be implemented by EF Core repositories later.
/// </summary>
public interface IPlanningRepository
{
    Task<PlanningResponse<AbsenceDto>> GetAbsencesAsync(string? employeeId = null, int? year = null, string? status = null);
    Task<AbsenceDto> SaveAbsenceAsync(AbsenceDto absence);
    Task DeleteAbsenceAsync(string id);

    Task<PlanningResponse<VacationBalanceDto>> GetVacationBalancesAsync(string? employeeId = null, int? year = null);

    Task<PlanningResponse<PlanningEventDto>> GetPlanningEventsAsync(string? employeeId = null);

    Task<object> GetPlanningSettingsAsync();
    Task<PlanningResponse<object>> GetTeamConfigurationsAsync();

    // EO-410: vacation request lifecycle + approval decision writeback
    Task<PlanningResponse<VacationRequestDto>> GetVacationRequestsAsync(string? status = null, string? userId = null, string? requestId = null, string? teamId = null);
    Task<VacationRequestDto> SaveVacationRequestAsync(VacationRequestDto request);
    Task DeleteVacationRequestAsync(string id);
    Task<VacationRequestDto?> ApplyApprovalDecisionAsync(ApprovalCallbackDto callback);

    /// <summary>
    /// Member-readable approval picker (default + candidates) for the absence form.
    /// <paramref name="owningTeamId"/> is the M365 host group id.
    /// </summary>
    Task<ApprovalOptionsDto> GetApprovalOptionsAsync(
        string owningTeamId,
        string? employeeId,
        IReadOnlyCollection<TeamMembershipDto> graphMembers);

    // Added for EO-406 / visible-data: required by frontend ApiPlanningRepositories.listMemberships()
    Task<PlanningResponse<TeamMembershipDto>> GetTeamMembershipsAsync(string? pageToken = null, string? teamId = null);

    /// <summary>
    /// Distinct Entra object ids with at least one team assignment (mailbox sync identity match).
    /// </summary>
    Task<IReadOnlyList<string>> ListAssignedUserIdsAsync();

    // EO-415: configurable organisations, locations and Graph profile value mappings
    Task<OrgConfigDto> GetOrgConfigAsync();
    Task<OrgConfigDto> SaveOrgConfigAsync(OrgConfigPatchDto patch);

    // EO-416: persisted holiday calendar
    Task<PlanningResponse<PublicHoliday>> GetPublicHolidaysAsync();
    Task<PlanningResponse<PublicHoliday>> ReplacePublicHolidaysAsync(IReadOnlyCollection<PublicHoliday> holidays);

    // EO-454: Team-level holiday calendar slot configuration (labels, tones, sources)
    Task<IReadOnlyCollection<HolidayCalendarSlot>> GetHolidayCalendarSlotsAsync(string teamId);
    Task<IReadOnlyCollection<HolidayCalendarSlot>> UpdateHolidayCalendarSlotsAsync(string teamId, IReadOnlyCollection<HolidayCalendarSlot> slots);

    // EO-421: tenant-wide display settings
    Task<DisplayConfigDto> GetDisplayConfigAsync();
    Task<DisplayConfigDto> SaveDisplayConfigAsync(DisplayConfigPatchDto patch);

    // EO-425: mailbox sync configuration
    Task<MailboxSyncConfigDto> GetMailboxSyncConfigAsync();
    Task<MailboxSyncConfigDto> SaveMailboxSyncConfigAsync(MailboxSyncConfigPatchDto patch);

    // EO-408: Team Admin Center persistence (normalized SQL)
    // EO-419: owningTeamId = M365 host team; internal teams are scoped to it.
    Task<PlanningResponse<TeamAdminTeamSummaryDto>> GetManagedTeamsAsync(string? owningTeamId = null);
    Task<TeamAdminDetailsDto> GetTeamAdminDetailsAsync(string teamId, string? owningTeamId = null);
    Task<TeamAdminDetailsDto> SaveTeamAdminChangesAsync(TeamAdminSaveRequestDto saveRequest, string? owningTeamId = null);
    /// <summary>Hard-delete host-scoped (and loose orphan) assignments for one Entra object id.</summary>
    Task<int> RemoveMemberFromHostAsync(string userId, string? owningTeamId = null);
    Task<TeamAdminTeamSummaryDto> CreateTeamAsync(TeamCreateRequestDto request);
    Task<PlanningResponse<TeamAdminTeamSummaryDto>> UpdateTeamsAsync(TeamsUpdateRequestDto request, string? owningTeamId = null);
    Task DeleteTeamAsync(string teamId, string? owningTeamId = null);

    // EO-424: inbound Outlook mailbox sync — lookup by iCalendar UID and date-range overlap detection
    Task<AbsenceDto?> GetAbsenceByIcsUidAsync(string icsUid);
    Task<List<AbsenceDto>> GetAbsencesByEmployeeAndDateRangeAsync(string employeeId, DateTime startDate, DateTime endDate);
}