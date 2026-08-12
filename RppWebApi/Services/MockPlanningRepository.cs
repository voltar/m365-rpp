using RppWebApi.Models;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace RppWebApi.Services;

/// <summary>
/// Mock implementation of IPlanningRepository that returns realistic data.
/// This mirrors the frontend mock repositories and allows the UI to work immediately.
/// Later this will be replaced by EF Core + SQL implementation.
/// </summary>
public class MockPlanningRepository : IPlanningRepository
{
    private readonly ILogger<MockPlanningRepository> _logger;

    public MockPlanningRepository(ILogger<MockPlanningRepository> logger)
    {
        _logger = logger;
    }

    public Task<PlanningResponse<AbsenceDto>> GetAbsencesAsync(string? employeeId = null, int? year = null, string? status = null)
    {
        _logger.LogInformation("MockPlanningRepository.GetAbsencesAsync called");

        var items = new List<AbsenceDto>
        {
            new AbsenceDto
            {
                Id = "absence-gianni-summer-001",
                EmployeeId = employeeId ?? "resource-alex-mueller",
                Type = "vacation",
                StartDate = DateTime.Parse("2026-07-06"),
                StartHalf = "fullDay",
                EndDate = DateTime.Parse("2026-07-31"),
                EndHalf = "fullDay",
                Duration = 20,
                Status = "approved",
                Comment = "Sommerferien",
                Created = DateTime.UtcNow.AddDays(-30),
                Modified = DateTime.UtcNow
            },
            new AbsenceDto
            {
                Id = "absence-anne-001",
                EmployeeId = "resource-anne-keller",
                Type = "vacation",
                StartDate = DateTime.Parse("2026-07-13"),
                StartHalf = "fullDay",
                EndDate = DateTime.Parse("2026-07-24"),
                EndHalf = "fullDay",
                Duration = 10,
                Status = "approved",
                Comment = "Sommerferien",
                Created = DateTime.UtcNow.AddDays(-25),
                Modified = DateTime.UtcNow
            }
        };

        if (!string.IsNullOrEmpty(employeeId))
            items = items.Where(a => a.EmployeeId == employeeId).ToList();

        return Task.FromResult(new PlanningResponse<AbsenceDto>
        {
            Items = items,
            TotalCount = items.Count
        });
    }

    public Task<AbsenceDto> SaveAbsenceAsync(AbsenceDto absence)
    {
        _logger.LogInformation("MockPlanningRepository.SaveAbsenceAsync for {EmployeeId}", absence.EmployeeId);
        absence.Id ??= $"abs-{Guid.NewGuid().ToString()[..8]}";
        absence.Modified = DateTime.UtcNow;
        return Task.FromResult(absence);
    }

    public Task DeleteAbsenceAsync(string id)
    {
        _logger.LogInformation("MockPlanningRepository.DeleteAbsenceAsync {Id}", id);
        return Task.CompletedTask;
    }

    public Task<PlanningResponse<VacationBalanceDto>> GetVacationBalancesAsync(string? employeeId = null, int? year = null)
    {
        var items = new List<VacationBalanceDto>
        {
            new VacationBalanceDto
            {
                EmployeeId = employeeId ?? "resource-alex-mueller",
                Year = year ?? DateTime.Today.Year,
                Entitlement = 25,
                CarryForward = 5,
                ManualAdjustment = 2,
                ApprovedVacation = 12,
                PendingVacation = 3,
                Remaining = 17
            }
        };

        return Task.FromResult(new PlanningResponse<VacationBalanceDto>
        {
            Items = items,
            TotalCount = items.Count
        });
    }

    public Task<PlanningResponse<PlanningEventDto>> GetPlanningEventsAsync(string? employeeId = null)
    {
        return Task.FromResult(new PlanningResponse<PlanningEventDto> { Items = new List<PlanningEventDto>() });
    }

    public Task<object> GetPlanningSettingsAsync()
    {
        return Task.FromResult<object>(new
        {
            planningHorizonMonths = 3,
            defaultView = "timeline",
            enableApprovalWorkflow = true,
            enableOutlookSync = true,
            schoolHolidayRegions = new[] { "ZH", "SG" }
        });
    }

    public Task<PlanningResponse<object>> GetTeamConfigurationsAsync()
    {
        return Task.FromResult(new PlanningResponse<object> { Items = new List<object>() });
    }

    // EO-410: in-memory vacation request lifecycle for development without a database
    private readonly List<VacationRequestDto> _vacationRequests = new();

    // EO-415: in-memory org config for development without a database
    private OrgConfigDto _orgConfig = new()
    {
        Organisations = new List<PlanningOrganisation> { new() { Id = "org-partner", Name = "Partnerorganisation", SortOrder = 0 } },
        Locations = new List<PlanningLocation>
        {
            new() { Id = "loc-duebendorf", Name = "Dübendorf", SortOrder = 0 },
            new() { Id = "loc-st-gallen", Name = "St. Gallen", SortOrder = 1 },
            new() { Id = "loc-thun", Name = "Thun", SortOrder = 2 }
        }
    };

    // EO-416: in-memory holiday calendar for development without a database
    private List<PublicHoliday> _publicHolidays = new();

    public Task<PlanningResponse<PublicHoliday>> GetPublicHolidaysAsync()
    {
        return Task.FromResult(new PlanningResponse<PublicHoliday> { Items = _publicHolidays, TotalCount = _publicHolidays.Count });
    }

    public Task<PlanningResponse<PublicHoliday>> ReplacePublicHolidaysAsync(IReadOnlyCollection<PublicHoliday> holidays)
    {
        _publicHolidays = holidays.ToList();
        return GetPublicHolidaysAsync();
    }

    // EO-454: in-memory holiday calendar slot configuration for development without a database
    private readonly Dictionary<string, List<HolidayCalendarSlot>> _holidaySlotsByTeam = new();

    public Task<IReadOnlyCollection<HolidayCalendarSlot>> GetHolidayCalendarSlotsAsync(string teamId)
    {
        _logger.LogInformation("MockPlanningRepository.GetHolidayCalendarSlotsAsync for team {TeamId}", teamId);
        
        if (!_holidaySlotsByTeam.TryGetValue(teamId, out var slots))
        {
            // Return empty list if no slots configured yet
            return Task.FromResult<IReadOnlyCollection<HolidayCalendarSlot>>(new List<HolidayCalendarSlot>());
        }

        return Task.FromResult<IReadOnlyCollection<HolidayCalendarSlot>>(slots.AsReadOnly());
    }

    public Task<IReadOnlyCollection<HolidayCalendarSlot>> UpdateHolidayCalendarSlotsAsync(string teamId, IReadOnlyCollection<HolidayCalendarSlot> slots)
    {
        _logger.LogInformation("MockPlanningRepository.UpdateHolidayCalendarSlotsAsync for team {TeamId} ({Count} slots)", teamId, slots.Count);
        
        var updated = slots.ToList();
        updated.ForEach(s => s.LastModified = DateTime.UtcNow);
        _holidaySlotsByTeam[teamId] = updated;

        return Task.FromResult<IReadOnlyCollection<HolidayCalendarSlot>>(updated.AsReadOnly());
    }

    // EO-421: in-memory display settings for development without a database
    private DisplayConfigDto _displayConfig = new();

    public Task<DisplayConfigDto> GetDisplayConfigAsync()
    {
        return Task.FromResult(_displayConfig);
    }

    public Task<DisplayConfigDto> SaveDisplayConfigAsync(DisplayConfigPatchDto patch)
    {
        _displayConfig = new DisplayConfigDto
        {
            ShowVacationSummary = patch.ShowVacationSummary ?? _displayConfig.ShowVacationSummary,
            EventColorMode = patch.EventColorMode ?? _displayConfig.EventColorMode
        };

        return Task.FromResult(_displayConfig);
    }

    // EO-425: in-memory mailbox sync config for development without a database
    private MailboxSyncConfigDto _mailboxSyncConfig = new();

    public Task<MailboxSyncConfigDto> GetMailboxSyncConfigAsync()
    {
        return Task.FromResult(_mailboxSyncConfig);
    }

    public Task<MailboxSyncConfigDto> SaveMailboxSyncConfigAsync(MailboxSyncConfigPatchDto patch)
    {
        _mailboxSyncConfig = new MailboxSyncConfigDto
        {
            MailboxAddress = patch.MailboxAddress?.Trim() ?? _mailboxSyncConfig.MailboxAddress
        };

        return Task.FromResult(_mailboxSyncConfig);
    }

    public Task<OrgConfigDto> GetOrgConfigAsync()
    {
        return Task.FromResult(_orgConfig);
    }

    public Task<OrgConfigDto> SaveOrgConfigAsync(OrgConfigPatchDto patch)
    {
        _orgConfig = new OrgConfigDto
        {
            Organisations = patch.Organisations,
            Locations = patch.Locations,
            Mappings = patch.Mappings
        };

        return Task.FromResult(_orgConfig);
    }

    public Task<PlanningResponse<VacationRequestDto>> GetVacationRequestsAsync(string? status = null, string? userId = null, string? requestId = null, string? teamId = null)
    {
        var items = _vacationRequests
            .Where(r => requestId == null || r.Id == requestId)
            .Where(r => userId == null || r.EmployeeId == userId)
            .Where(r => teamId == null || r.TeamId == teamId)
            .Where(r => status == null || r.Status == status)
            .ToList();

        return Task.FromResult(new PlanningResponse<VacationRequestDto> { Items = items, TotalCount = items.Count });
    }

    public Task<VacationRequestDto> SaveVacationRequestAsync(VacationRequestDto request)
    {
        if (string.IsNullOrEmpty(request.Id))
        {
            request.Id = $"vacation-request-{Guid.NewGuid().ToString()[..12]}";
        }

        _vacationRequests.RemoveAll(r => r.Id == request.Id);
        request.Modified = DateTime.UtcNow;
        _vacationRequests.Add(request);
        return Task.FromResult(request);
    }

    public Task DeleteVacationRequestAsync(string id)
    {
        _vacationRequests.RemoveAll(r => r.Id == id);
        return Task.CompletedTask;
    }

    public Task<VacationRequestDto?> ApplyApprovalDecisionAsync(ApprovalCallbackDto callback)
    {
        var request = _vacationRequests.FirstOrDefault(r => r.Id == callback.RequestId && r.Status == "pendingApproval");

        if (request is null || request.ApprovalReferenceId != callback.ApprovalReferenceId)
        {
            return Task.FromResult<VacationRequestDto?>(null);
        }

        request.Status = string.Equals(callback.Decision, "approved", StringComparison.OrdinalIgnoreCase) ? "approved" : "rejected";
        request.DecisionBy = callback.DecisionBy;
        request.DecisionComment = callback.DecisionComment;
        request.Modified = DateTime.UtcNow;
        return Task.FromResult<VacationRequestDto?>(request);
    }

    public Task<ApprovalOptionsDto> GetApprovalOptionsAsync(
        string owningTeamId,
        string? employeeId,
        IReadOnlyCollection<TeamMembershipDto> graphMembers)
    {
        var candidates = graphMembers
            .Where(member => !string.IsNullOrWhiteSpace(member.Member.Id))
            .Where(member =>
                string.IsNullOrWhiteSpace(employeeId)
                || !string.Equals(member.Member.Id, employeeId, StringComparison.OrdinalIgnoreCase))
            .Select(member => new ApprovalCandidateDto
            {
                UserId = member.Member.Id,
                DisplayName = member.Member.DisplayName
            })
            .ToList();

        if (candidates.Count == 0)
        {
            candidates.Add(new ApprovalCandidateDto { UserId = "mock-approver", DisplayName = "Mock Approver" });
        }

        return Task.FromResult(new ApprovalOptionsDto
        {
            DefaultApproverUserId = candidates[0].UserId,
            AllowOverride = true,
            ApprovalExempt = false,
            Candidates = candidates
        });
    }

    public Task<IReadOnlyList<string>> ListAssignedUserIdsAsync() =>
        Task.FromResult<IReadOnlyList<string>>(new[] { "resource-alex-mueller", "resource-anne-keller" });

    public Task<PlanningResponse<TeamMembershipDto>> GetTeamMembershipsAsync(string? pageToken = null, string? teamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.GetTeamMembershipsAsync called (pageToken={PageToken}, teamId={TeamId})", pageToken, teamId);

        // Return realistic data matching the controller and frontend mocks (prevents "keine planbaren Personen gefunden")
        // EO-408: Mock is kept only for development fallback - real data comes from Graph + persisted assignments
        var members = new List<TeamMembershipDto>
        {
            new TeamMembershipDto
            {
                Id = "mship-gz-001",
                Member = new TeamMemberDto
                {
                    Id = "resource-alex-mueller",
                    DisplayName = "Alex Mueller",
                    Mail = "alex.mueller@contoso.onmicrosoft.com",
                    Initials = "GZ",
                    Organization = "Organisation-A",
                    IsGuest = false
                },
                TeamId = "rpp",
                TeamName = "Platform Team",
                IsPrimary = true
            },
            new TeamMembershipDto
            {
                Id = "mship-ak-001",
                Member = new TeamMemberDto
                {
                    Id = "resource-anne-keller",
                    DisplayName = "Anne Keller",
                    Mail = "anne.keller@organisation-a.example",
                    Initials = "AK",
                    Organization = "Organisation-A",
                    IsGuest = false
                },
                TeamId = "rpp",
                TeamName = "Platform Team",
                IsPrimary = true
            }
        };

        if (!string.IsNullOrWhiteSpace(teamId))
        {
            members = members
                .Where(member => string.Equals(member.TeamId, teamId, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        return Task.FromResult(new PlanningResponse<TeamMembershipDto>
        {
            Items = members,
            TotalCount = members.Count,
            NextPageToken = null
        });
    }

    // EO-408 stubs (required for interface compliance - real implementation is in EfPlanningRepository)
    public Task<PlanningResponse<TeamAdminTeamSummaryDto>> GetManagedTeamsAsync(string? owningTeamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.GetManagedTeamsAsync called - returning empty (EfPlanningRepository is active)");
        return Task.FromResult(new PlanningResponse<TeamAdminTeamSummaryDto> { Items = new List<TeamAdminTeamSummaryDto>() });
    }

    public Task<TeamAdminDetailsDto> GetTeamAdminDetailsAsync(string teamId, string? owningTeamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.GetTeamAdminDetailsAsync called for {TeamId} - returning stub", teamId);
        return Task.FromResult(new TeamAdminDetailsDto());
    }

    public Task<TeamAdminDetailsDto> SaveTeamAdminChangesAsync(TeamAdminSaveRequestDto saveRequest, string? owningTeamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.SaveTeamAdminChangesAsync called");
        return Task.FromResult(new TeamAdminDetailsDto());
    }

    public Task<int> RemoveMemberFromHostAsync(string userId, string? owningTeamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.RemoveMemberFromHostAsync called for {UserId}", userId);
        return Task.FromResult(0);
    }

    public Task<TeamAdminTeamSummaryDto> CreateTeamAsync(TeamCreateRequestDto request)
    {
        _logger.LogInformation("MockPlanningRepository.CreateTeamAsync called");
        return Task.FromResult(new TeamAdminTeamSummaryDto { TeamId = "mock", TeamName = request.TeamName });
    }

    public Task<PlanningResponse<TeamAdminTeamSummaryDto>> UpdateTeamsAsync(TeamsUpdateRequestDto request, string? owningTeamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.UpdateTeamsAsync called");
        return Task.FromResult(new PlanningResponse<TeamAdminTeamSummaryDto> { Items = new List<TeamAdminTeamSummaryDto>() });
    }

    public Task DeleteTeamAsync(string teamId, string? owningTeamId = null)
    {
        _logger.LogInformation("MockPlanningRepository.DeleteTeamAsync called for {TeamId}", teamId);
        return Task.CompletedTask;
    }

    // EO-424: inbound Outlook mailbox sync — mock implementations

    public Task<AbsenceDto?> GetAbsenceByIcsUidAsync(string icsUid)
    {
        _logger.LogInformation("MockPlanningRepository.GetAbsenceByIcsUidAsync called for IcsUid={IcsUid}", icsUid);
        return Task.FromResult<AbsenceDto?>(null);
    }

    public Task<List<AbsenceDto>> GetAbsencesByEmployeeAndDateRangeAsync(string employeeId, DateTime startDate, DateTime endDate)
    {
        _logger.LogInformation("MockPlanningRepository.GetAbsencesByEmployeeAndDateRangeAsync called for {EmployeeId}", employeeId);
        return Task.FromResult(new List<AbsenceDto>());
    }
}