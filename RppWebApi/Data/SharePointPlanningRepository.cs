using System.Text.Json;
using RppWebApi.Models;
using RppWebApi.Services;
using static RppWebApi.Data.SharePointListSchema;

namespace RppWebApi.Data;

/// <summary>
/// EO-430: the server-side planning store backed by SharePoint Online lists (ADR-002, entry tier).
///
/// Three things make this more than a port of <see cref="EfPlanningRepository"/>:
///
/// - **Person columns hold a site lookup id, not a Graph id.** Every read projects through
///   <see cref="SharePointSiteUserDirectory"/>, and every person-scoped filter resolves the employee
///   to a lookup id first, because OData cannot filter a person column by Graph id (FR-430.7/.12).
/// - **There are no global query filters.** EF applied soft-delete filters everywhere from one
///   declaration; here every read carries them explicitly (<see cref="SoftDelete"/>).
/// - **The application is not the only writer.** People maintain these lists by hand, so a read
///   must survive a cleared column or an unresolvable person rather than fail the request.
///
/// Delivery stage 1 implements the read path. Writes arrive in stage 2 with ETag concurrency
/// (FR-430.13) and throw until then, rather than silently doing nothing.
/// </summary>
public class SharePointPlanningRepository : IPlanningRepository
{
    private const int PageSize = 500;

    private readonly SharePointClient _client;
    private readonly SharePointSiteUserDirectory _directory;
    private readonly GraphTeamMembershipService _graphService;
    private readonly ILogger<SharePointPlanningRepository> _logger;

    public SharePointPlanningRepository(
        SharePointClient client,
        SharePointSiteUserDirectory directory,
        GraphTeamMembershipService graphService,
        ILogger<SharePointPlanningRepository> logger)
    {
        _client = client;
        _directory = directory;
        _graphService = graphService;
        _logger = logger;
    }

    // --- Absences ------------------------------------------------------------

    public async Task<PlanningResponse<AbsenceDto>> GetAbsencesAsync(string? employeeId = null, int? year = null, string? status = null)
    {
        var filters = new List<string>();

        // The soft-delete filter is the default, not an option: an absence the application considers
        // deleted must never reach a caller. An explicit status filter replaces it only because the
        // caller then names the status it wants, including "deleted".
        filters.Add(string.IsNullOrWhiteSpace(status)
            ? SoftDelete.AbsenceFilter
            : $"Status eq {Literal(status)}");

        if (!string.IsNullOrWhiteSpace(employeeId))
        {
            var lookupId = await _directory.ResolveLookupIdAsync(employeeId);

            if (lookupId is null)
            {
                // Answering a question about one employee with everybody's records would be worse
                // than answering with none. An employee the site does not know has no absences here.
                _logger.LogInformation(
                    "Absence query for an employee unknown to the SharePoint site returned no rows.");

                return Empty<AbsenceDto>();
            }

            filters.Add($"{People.LookupField(People.User)} eq {lookupId}");
        }

        if (year is { } requestedYear)
        {
            filters.Add($"{EventRange.Start} ge datetime'{requestedYear:0000}-01-01T00:00:00Z'");
            filters.Add($"{EventRange.Start} le datetime'{requestedYear:0000}-12-31T23:59:59Z'");
        }

        var items = await QueryAsync(Lists.Absences, AbsenceSelect, And(filters), EventRange.Start);

        return Wrap(await MapAsync(items, MapAbsenceAsync));
    }

    public async Task<AbsenceDto?> GetAbsenceByIcsUidAsync(string icsUid)
    {
        if (string.IsNullOrWhiteSpace(icsUid))
        {
            return null;
        }

        var filter = And([SoftDelete.AbsenceFilter, $"IcsUid eq {Literal(icsUid)}"]);
        var items = await QueryAsync(Lists.Absences, AbsenceSelect, filter, orderBy: null, top: 1);

        return items.Count == 0 ? null : await MapAbsenceAsync(items[0]);
    }

    public async Task<List<AbsenceDto>> GetAbsencesByEmployeeAndDateRangeAsync(string employeeId, DateTime startDate, DateTime endDate)
    {
        var lookupId = await _directory.ResolveLookupIdAsync(employeeId);

        if (lookupId is null)
        {
            return [];
        }

        // Overlap, not containment: an absence starting before the window and ending inside it is
        // still an overlap, and EO-424 depends on finding it to avoid creating a duplicate.
        var filter = And(
        [
            SoftDelete.AbsenceFilter,
            $"{People.LookupField(People.User)} eq {lookupId}",
            $"{EventRange.Start} le datetime'{Iso(endDate)}'",
            $"{EventRange.End} ge datetime'{Iso(startDate)}'"
        ]);

        var items = await QueryAsync(Lists.Absences, AbsenceSelect, filter, EventRange.Start);

        return await MapAsync(items, MapAbsenceAsync);
    }

    // No duration column: the day count is derived from the two dates and the two day halves, so it
    // is a calculated value and is not stored (see AbsenceDuration). Storing it would put a number
    // in the edit form that a person can set to something the application disagrees with — the same
    // failure the retired vacation-balance columns had.
    private const string AbsenceSelect =
        "Id,Title,UserPersonId,SubstitutePersonId,Type,EventDate,StartHalf,EndDate,EndHalf," +
        "Comment,Status,ApprovalStatus,VacationRequestId,CreatedAt,ModifiedAt,IcsUid,Source";

    private async Task<AbsenceDto> MapAbsenceAsync(SharePointListItem item)
    {
        var startDate = item.GetDate(EventRange.Start);
        var startHalf = item.GetString("StartHalf", "fullDay");
        var endDate = item.GetDate(EventRange.End);
        var endHalf = item.GetString("EndHalf", "fullDay");

        return new AbsenceDto
        {
            Id = item.ItemId.ToString(),
            // An unresolvable person leaves the id empty and keeps the row: an absence is a fact
            // even when the account behind it is gone (FR-430.12).
            EmployeeId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.User)) ?? string.Empty,
            Substitute = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.Substitute)),
            Type = item.GetString("Type"),
            StartDate = startDate,
            StartHalf = startHalf,
            EndDate = endDate,
            EndHalf = endHalf,
            Duration = AbsenceDuration.Calculate(startDate, startHalf, endDate, endHalf),
            Comment = item.GetOptionalString("Comment"),
            Status = item.GetString("Status", "approved"),
            ApprovalStatus = item.GetString("ApprovalStatus", "approved"),
            VacationRequestId = item.GetOptionalString("VacationRequestId"),
            Created = item.GetDateTime(Timestamps.CreatedAt),
            Modified = item.GetDateTime(Timestamps.ModifiedAt),
            IcsUid = item.GetOptionalString("IcsUid"),
            Source = item.GetString("Source", "manual")
        };
    }

    // --- Vacation balances ---------------------------------------------------

    public async Task<PlanningResponse<VacationBalanceDto>> GetVacationBalancesAsync(string? employeeId = null, int? year = null)
    {
        var filters = new List<string>();

        if (!string.IsNullOrWhiteSpace(employeeId))
        {
            var lookupId = await _directory.ResolveLookupIdAsync(employeeId);

            if (lookupId is null)
            {
                return Empty<VacationBalanceDto>();
            }

            filters.Add($"{People.LookupField(People.User)} eq {lookupId}");
        }

        if (year is { } requestedYear)
        {
            filters.Add($"Year eq {requestedYear}");
        }

        var items = await QueryAsync(
            Lists.VacationBalances,
            "Id,UserPersonId,Year,Entitlement,CarryForward,ManualAdjustment,Comment",
            And(filters),
            "Year");

        return Wrap(await MapAsync(items, async item => new VacationBalanceDto
        {
            EmployeeId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.User)) ?? string.Empty,
            Year = item.GetInt("Year") ?? 0,
            Entitlement = item.GetDecimal("Entitlement"),
            CarryForward = item.GetDecimal("CarryForward"),
            ManualAdjustment = item.GetDecimal("ManualAdjustment"),
            Comment = item.GetOptionalString("Comment")

            // ApprovedVacation, PendingVacation and Remaining are deliberately not read. They are
            // calculated values and are never persisted (CLAUDE.md, AGENTS.md); the legacy columns
            // that held them are retired by FR-430.14.
        }));
    }

    // --- Planning events -----------------------------------------------------

    public async Task<PlanningResponse<PlanningEventDto>> GetPlanningEventsAsync(string? employeeId = null)
    {
        var filters = new List<string>();

        if (!string.IsNullOrWhiteSpace(employeeId))
        {
            var lookupId = await _directory.ResolveLookupIdAsync(employeeId);

            if (lookupId is null)
            {
                return Empty<PlanningEventDto>();
            }

            filters.Add($"{People.LookupField(People.Resource)} eq {lookupId}");
        }

        var items = await QueryAsync(
            Lists.PlanningEvents,
            "Id,Title,ResourcePersonId,Type,EventDate,EndDate,Comment,CreatedAt,ModifiedAt",
            And(filters),
            EventRange.Start);

        return Wrap(await MapAsync(items, async item => new PlanningEventDto
        {
            Id = item.ItemId.ToString(),
            EmployeeId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.Resource)) ?? string.Empty,
            Type = item.GetString("Type"),
            Title = item.GetString("Title"),
            StartDate = item.GetDate(EventRange.Start),
            EndDate = item.GetDate(EventRange.End),
            Comment = item.GetOptionalString("Comment"),
            Created = item.GetDateTime(Timestamps.CreatedAt),
            Modified = item.GetDateTime(Timestamps.ModifiedAt)
        }));
    }

    // --- Vacation requests ---------------------------------------------------

    public async Task<PlanningResponse<VacationRequestDto>> GetVacationRequestsAsync(
        string? status = null, string? userId = null, string? requestId = null, string? teamId = null)
    {
        var filters = new List<string>
        {
            string.IsNullOrWhiteSpace(status)
                ? SoftDelete.VacationRequestFilter
                : $"Status eq {Literal(status)}"
        };

        if (!string.IsNullOrWhiteSpace(requestId))
        {
            filters.Add($"RequestId eq {Literal(requestId)}");
        }

        if (!string.IsNullOrWhiteSpace(teamId))
        {
            filters.Add($"TeamId eq {Literal(teamId)}");
        }

        if (!string.IsNullOrWhiteSpace(userId))
        {
            var lookupId = await _directory.ResolveLookupIdAsync(userId);

            if (lookupId is null)
            {
                return Empty<VacationRequestDto>();
            }

            filters.Add($"{People.LookupField(People.User)} eq {lookupId}");
        }

        var items = await QueryAsync(Lists.VacationRequests, VacationRequestSelect, And(filters), "StartDate");

        return Wrap(await MapAsync(items, MapVacationRequestAsync));
    }

    // Same as Absences: no duration column, the day count is calculated.
    private const string VacationRequestSelect =
        "Id,RequestId,UserPersonId,ApproverPersonId,Type,StartDate,StartHalf,EndDate,EndHalf," +
        "Status,ApprovalReferenceId,SyncToOutlook,Comment,TeamId,CommentToApprover,ApprovalProvider," +
        "FlowRunId,DecisionByPersonId,DecisionDate,DecisionComment,GraphEventId,OutlookSyncStatus," +
        "OutlookSyncError,CreatedAt,ModifiedAt";

    private async Task<VacationRequestDto> MapVacationRequestAsync(SharePointListItem item)
    {
        var startDate = item.GetDate("StartDate");
        var startHalf = item.GetString("StartHalf", "fullDay");
        var endDate = item.GetDate("EndDate");
        var endHalf = item.GetString("EndHalf", "fullDay");

        return new VacationRequestDto
        {
        // The API's id is the business RequestId where the list carries one, so an approval callback
        // keeps matching after a person edits the row. The item id is the storage identity only.
        Id = item.GetOptionalString("RequestId") ?? item.ItemId.ToString(),
        EmployeeId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.User)) ?? string.Empty,
        ApproverId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.Approver)),
        Type = item.GetString("Type", "vacation"),
        StartDate = startDate,
        StartHalf = startHalf,
        EndDate = endDate,
        EndHalf = endHalf,
        Duration = AbsenceDuration.Calculate(startDate, startHalf, endDate, endHalf),
        Status = item.GetString("Status", "draft"),
        ApprovalReferenceId = item.GetOptionalString("ApprovalReferenceId"),
        SyncToOutlook = item.GetBoolean("SyncToOutlook", true),
        Comment = item.GetOptionalString("Comment"),
        TeamId = item.GetString("TeamId"),

        // FR-430.5: no display name is stored. The pending and decision panels resolve it from
        // Graph at read time; leaving it empty here is the point, not an omission.
        UserDisplayName = string.Empty,

        CommentToApprover = item.GetOptionalString("CommentToApprover"),
        ApprovalProvider = item.GetString("ApprovalProvider", "none"),
        FlowRunId = item.GetOptionalString("FlowRunId"),

        // The decider is a person column like every other person-valued fact (FR-430.12). The old
        // 'DecisionBy' text twin is retired, so reading it by name would have returned nothing.
        DecisionBy = await _directory.ResolveGraphUserIdAsync(item.GetLookupId("DecisionByPerson")),
        DecisionDate = item.GetOptionalDateTime("DecisionDate"),
        DecisionComment = item.GetOptionalString("DecisionComment"),
        GraphEventId = item.GetOptionalString("GraphEventId"),
        OutlookSyncStatus = item.GetString("OutlookSyncStatus", "notRequired"),
        OutlookSyncError = item.GetOptionalString("OutlookSyncError"),
        Created = item.GetDateTime(Timestamps.CreatedAt),
        Modified = item.GetDateTime(Timestamps.ModifiedAt)
        };
    }

    // --- Public holidays -----------------------------------------------------

    public async Task<PlanningResponse<PublicHoliday>> GetPublicHolidaysAsync()
    {
        var items = await QueryAsync(Lists.PublicHolidays, "Id,Title,EventDate,Location", filter: null, EventRange.Start);

        return Wrap(items.Select(item => new PublicHoliday
        {
            Id = item.ItemId.ToString(),
            Date = item.GetDate(EventRange.Start).ToString("yyyy-MM-dd"),

            // The holiday name is the calendar label, so it is Title — there is no separate Label
            // column, and reading one would have been reading an empty duplicate.
            Label = item.GetString("Title"),

            // Null for capacity-relevant public holidays, set for school holidays. The provider
            // derives IsSchoolHoliday from this, which is why FR-430.14 could relax that column.
            Location = item.GetOptionalString("Location")
        }).ToList());
    }

    // --- Settings and configuration -----------------------------------------

    public async Task<object> GetPlanningSettingsAsync()
    {
        // FR-430.4: with ResourceProfiles moved out, what remains is scalar tenant settings with no
        // person reference, so this is a plain key/value read rather than the special case it was
        // in the SQL profile (where it is still hardcoded behind a TODO).
        var items = await QueryAsync(Lists.PlanningSettings, "Id,Key,Value,Scope", filter: null, "Key");

        var settings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            var key = item.GetString("Key");

            if (!string.IsNullOrWhiteSpace(key))
            {
                settings[key] = item.GetString("Value");
            }
        }

        return settings;
    }

    public async Task<PlanningResponse<object>> GetTeamConfigurationsAsync()
    {
        var items = await QueryAsync(
            Lists.TeamPlanningConfiguration,
            "Id,TeamId,TeamName,DefaultApproverPersonId,BackupApproverPersonId,ApprovalRequired,OutlookSyncEnabled,Comment,LastModified",
            filter: null,
            "TeamName");

        var configurations = await MapAsync(items, async item => (object)new TeamConfiguration
        {
            Id = item.ItemId.ToString(),
            TeamId = item.GetString("TeamId"),
            TeamName = item.GetString("TeamName"),
            DefaultApproverId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.DefaultApprover)) ?? string.Empty,
            BackupApproverId = await _directory.ResolveGraphUserIdAsync(item.GetLookupId("BackupApproverPerson")),
            ApprovalRequired = item.GetBoolean("ApprovalRequired", true),
            OutlookSyncEnabled = item.GetBoolean("OutlookSyncEnabled", true),
            Comment = item.GetOptionalString("Comment"),
            LastModified = item.GetDateTime(Timestamps.LastModified)
        });

        return Wrap(configurations);
    }

    public async Task<OrgConfigDto> GetOrgConfigAsync()
    {
        // Not 'Name': that is the built-in FileLeafRef's display name in every SharePoint list, so
        // the custom column carries a qualified internal name instead (see the provisioning script).
        var organisationItems = await QueryAsync(Lists.Organisations, "Id,OrganisationName,SortOrder", filter: null, "SortOrder");
        var locationItems = await QueryAsync(Lists.Locations, "Id,LocationName,SortOrder", filter: null, "SortOrder");
        var mappingItems = await QueryAsync(Lists.ProfileValueMappings, "Id,Kind,GraphValue,TargetId", filter: null, "Kind");

        return new OrgConfigDto
        {
            Organisations = organisationItems.Select(item => new PlanningOrganisation
            {
                Id = item.ItemId.ToString(),
                Name = item.GetString("OrganisationName"),
                SortOrder = item.GetInt("SortOrder") ?? 0
            }).ToList(),

            Locations = locationItems.Select(item => new PlanningLocation
            {
                Id = item.ItemId.ToString(),
                Name = item.GetString("LocationName"),
                SortOrder = item.GetInt("SortOrder") ?? 0
            }).ToList(),

            Mappings = mappingItems.Select(item => new ProfileValueMapping
            {
                Id = item.ItemId.ToString(),
                Kind = item.GetString("Kind", "organisation"),
                GraphValue = item.GetString("GraphValue"),
                TargetId = item.GetString("TargetId")
            }).ToList()

            // UnmappedOrganisationValues / UnmappedLocationValues are computed against live Graph
            // profile values by the caller, not stored.
        };
    }

    public async Task<DisplayConfigDto> GetDisplayConfigAsync()
    {
        var items = await QueryAsync(
            Lists.DisplaySettings,
            "Id,ShowVacationSummary,EventColorMode",
            filter: null,
            orderBy: null,
            top: 1);

        // A singleton list that is empty is not an error: it means nobody has changed the defaults.
        return items.Count == 0
            ? new DisplayConfigDto()
            : new DisplayConfigDto
            {
                ShowVacationSummary = items[0].GetBoolean("ShowVacationSummary", true),
                EventColorMode = items[0].GetString("EventColorMode", "byType")
            };
    }

    public async Task<MailboxSyncConfigDto> GetMailboxSyncConfigAsync()
    {
        var items = await QueryAsync(
            Lists.MailboxSyncConfigs,
            "Id,MailboxAddress,LastModified",
            filter: null,
            orderBy: null,
            top: 1);

        return items.Count == 0
            ? new MailboxSyncConfigDto()
            : new MailboxSyncConfigDto { MailboxAddress = items[0].GetString("MailboxAddress") };
    }

    // --- Teams and memberships ----------------------------------------------

    public async Task<PlanningResponse<TeamAdminTeamSummaryDto>> GetManagedTeamsAsync(string? owningTeamId = null)
    {
        var teams = await LoadTeamsAsync(owningTeamId);
        var settingsByTeamId = await LoadTeamSettingsAsync();
        var assignments = await LoadAssignmentsAsync();

        var summaries = await MapAsync(teams, async team =>
        {
            var summary = await ToSummaryAsync(team, settingsByTeamId.GetValueOrDefault(team.GetString("TeamId")));

            summary.MemberCount = assignments.Count(assignment =>
                string.Equals(assignment.TeamId, summary.TeamId, StringComparison.OrdinalIgnoreCase));

            return summary;
        });

        return Wrap(summaries);
    }

    public async Task<TeamAdminDetailsDto> GetTeamAdminDetailsAsync(string teamId, string? owningTeamId = null)
    {
        var teams = await LoadTeamsAsync(owningTeamId);
        var settingsByTeamId = await LoadTeamSettingsAsync();
        var assignments = await LoadAssignmentsAsync();

        var team = teams.FirstOrDefault(candidate =>
            string.Equals(candidate.GetString("TeamId"), teamId, StringComparison.OrdinalIgnoreCase));

        var summary = team is { } found
            ? await ToSummaryAsync(found, settingsByTeamId.GetValueOrDefault(teamId))
            : new TeamAdminTeamSummaryDto { TeamId = teamId };

        var graphMembers = await _graphService.GetRealTeamMembersAsync(owningTeamId);
        var membersByUserId = graphMembers
            .Where(member => !string.IsNullOrWhiteSpace(member.Member?.Id))
            .GroupBy(member => member.Member.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var teamAssignments = assignments
            .Where(assignment => string.Equals(assignment.TeamId, teamId, StringComparison.OrdinalIgnoreCase))
            .ToList();

        summary.MemberCount = teamAssignments.Count;

        var absenceTypes = await LoadAbsenceTypesAsync();

        return new TeamAdminDetailsDto
        {
            Team = summary,
            Members = teamAssignments.Select(assignment => ToMemberDto(assignment, assignments, membersByUserId)).ToList(),
            AssignableMembers = assignments
                .GroupBy(assignment => assignment.UserId, StringComparer.OrdinalIgnoreCase)
                .Select(group => ToMemberDto(group.First(), assignments, membersByUserId))
                .ToList(),
            AllowedApprovers = graphMembers
                .Where(member => !string.IsNullOrWhiteSpace(member.Member?.Id))
                .Select(member => new TeamAdminPersonDto
                {
                    UserId = member.Member.Id,
                    DisplayName = member.Member.DisplayName,
                    Email = member.Member.Mail ?? string.Empty
                })
                .ToList(),
            AbsenceEntryTypes = absenceTypes,
            TeamOptions = teams.Select(candidate => new TeamAdminTeamOptionDto
            {
                TeamId = candidate.GetString("TeamId"),
                TeamName = candidate.GetString("TeamName")
            }).ToList()
        };
    }

    public async Task<IReadOnlyList<string>> ListAssignedUserIdsAsync()
    {
        var assignments = await LoadAssignmentsAsync();
        return assignments
            .Select(a => a.UserId)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<PlanningResponse<TeamMembershipDto>> GetTeamMembershipsAsync(string? pageToken = null, string? teamId = null)
    {
        var teams = await LoadTeamsAsync(null);
        var assignments = await LoadAssignmentsAsync();
        var graphMembers = await _graphService.GetRealTeamMembersAsync(teamId);

        var membersByUserId = graphMembers
            .Where(member => !string.IsNullOrWhiteSpace(member.Member?.Id))
            .GroupBy(member => member.Member.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var teamNamesByTeamId = teams.ToDictionary(
            team => team.GetString("TeamId"),
            team => team.GetString("TeamName"),
            StringComparer.OrdinalIgnoreCase);

        // EO-420: the caller passes the M365 host-group id, while assignments reference internal
        // planning team ids. Resolve the host scope via OwningTeamId, accepting an internal team id
        // too so direct team filters keep working.
        var scopedTeamIds = string.IsNullOrWhiteSpace(teamId)
            ? null
            : teams
                .Where(team =>
                    string.Equals(team.GetString("OwningTeamId"), teamId, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(team.GetString("TeamId"), teamId, StringComparison.OrdinalIgnoreCase))
                .Select(team => team.GetString("TeamId"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var memberships = assignments
            .Where(assignment => scopedTeamIds is null || scopedTeamIds.Contains(assignment.TeamId))
            .Where(assignment => teamNamesByTeamId.ContainsKey(assignment.TeamId))
            .Select(assignment =>
            {
                var member = membersByUserId.TryGetValue(assignment.UserId, out var graphMember)
                    ? CloneMember(graphMember.Member)
                    : new TeamMemberDto { Id = assignment.UserId };

                return new TeamMembershipDto
                {
                    Id = $"{assignment.UserId}-{assignment.TeamId}",
                    TeamId = assignment.TeamId,
                    TeamName = teamNamesByTeamId[assignment.TeamId],
                    IsPrimary = assignment.IsPrimary,
                    Member = member
                };
            })
            .ToList();

        // EO-415: same mapping path as EF — Graph raw company/office → configured names.
        await ResolveOrgLocationAsync(memberships);

        return Wrap(memberships);
    }

    private async Task ResolveOrgLocationAsync(IReadOnlyCollection<TeamMembershipDto> members)
    {
        if (members.Count == 0)
        {
            return;
        }

        var config = await GetOrgConfigAsync();
        var organisationNames = config.Organisations.ToDictionary(o => o.Id, o => o.Name, StringComparer.OrdinalIgnoreCase);
        var locationNames = config.Locations.ToDictionary(l => l.Id, l => l.Name, StringComparer.OrdinalIgnoreCase);

        string Resolve(string kind, string? rawValue, IReadOnlyDictionary<string, string> names)
        {
            if (string.IsNullOrWhiteSpace(rawValue))
            {
                return string.Empty;
            }

            var mapping = config.Mappings.FirstOrDefault(m =>
                string.Equals(m.Kind, kind, StringComparison.OrdinalIgnoreCase)
                && string.Equals(m.GraphValue, rawValue, StringComparison.OrdinalIgnoreCase));

            return mapping is not null && names.TryGetValue(mapping.TargetId, out var name)
                ? name
                : rawValue;
        }

        foreach (var membership in members)
        {
            membership.Member.Organization = Resolve("organisation", membership.Member.RawOrganizationValue, organisationNames);
            membership.Member.Location = Resolve("location", membership.Member.RawLocationValue, locationNames);
        }
    }

    private static TeamMemberDto CloneMember(TeamMemberDto source) => new()
    {
        Id = source.Id,
        DisplayName = source.DisplayName,
        Mail = source.Mail,
        Initials = source.Initials,
        Organization = source.Organization,
        Location = source.Location,
        RawOrganizationValue = source.RawOrganizationValue,
        RawLocationValue = source.RawLocationValue,
        IsGuest = source.IsGuest,
        IsOwner = source.IsOwner
    };

    private async Task<List<SharePointListItem>> LoadTeamsAsync(string? owningTeamId)
    {
        var filter = string.IsNullOrWhiteSpace(owningTeamId)
            ? null
            : $"OwningTeamId eq {Literal(owningTeamId)}";

        return await QueryAsync(
            Lists.TeamAdminTeams,
            "Id,TeamId,TeamName,Organization,OwningTeamId,SortOrder,RequiredStaffing,Color,CanManage,LastModified",
            filter,
            "SortOrder");
    }

    private async Task<Dictionary<string, SharePointListItem>> LoadTeamSettingsAsync()
    {
        var items = await QueryAsync(
            Lists.TeamAdminSettings,
            "Id,TeamId,TeamLeadPersonId,DefaultApproverPersonId,BackupApproverPersonId,ApprovalPolicy,OutlookSyncPolicy,AllowUserOverride,OutlookSyncEnabled",
            filter: null,
            orderBy: null);

        var byTeamId = new Dictionary<string, SharePointListItem>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            var key = item.GetString("TeamId");

            if (!string.IsNullOrWhiteSpace(key))
            {
                byTeamId[key] = item;
            }
        }

        return byTeamId;
    }

    private async Task<List<AssignmentRow>> LoadAssignmentsAsync()
    {
        var items = await QueryAsync(
            Lists.TeamAdminMemberAssignments,
            "Id,UserPersonId,TeamId,IsPrimary,AdditionalPosition,EmploymentPercentage,WorkingDays,VacationBalance,ApprovalExempt,EffectiveApproverPersonId",
            filter: null,
            "TeamId");

        return await MapAsync(items, async item => new AssignmentRow(
            await _directory.ResolveGraphUserIdAsync(item.GetLookupId(People.User)) ?? string.Empty,
            item.GetString("TeamId"),
            item.GetBoolean("IsPrimary"),
            item.GetDecimal("EmploymentPercentage", 100m),
            item.GetDecimal("VacationBalance", 25m),
            item.GetBoolean("ApprovalExempt"),
            await _directory.ResolveGraphUserIdAsync(item.GetLookupId("EffectiveApproverPerson"))));
    }

    private async Task<List<TeamAdminAbsenceEntryTypeDto>> LoadAbsenceTypesAsync()
    {
        var items = await QueryAsync(
            Lists.TeamAdminAbsenceTypes,
            "Id,Key,Label,LabelKey,Active,RequiresApproval,ConsumesVacationBalance,SortOrder",
            filter: null,
            "SortOrder");

        return items.Select(item => new TeamAdminAbsenceEntryTypeDto
        {
            Key = item.GetString("Key"),
            Label = item.GetOptionalString("Label"),
            LabelKey = item.GetOptionalString("LabelKey"),
            Active = item.GetBoolean("Active", true),
            RequiresApproval = item.GetBoolean("RequiresApproval", true),
            ConsumesVacationBalance = item.GetBoolean("ConsumesVacationBalance")
        }).ToList();
    }

    private async Task<TeamAdminTeamSummaryDto> ToSummaryAsync(SharePointListItem team, SharePointListItem? settings)
    {
        var summary = new TeamAdminTeamSummaryDto
        {
            TeamId = team.GetString("TeamId"),
            TeamName = team.GetString("TeamName"),
            Organization = team.GetString("Organization"),
            SortOrder = team.GetInt("SortOrder") ?? 0,
            RequiredStaffing = team.GetInt("RequiredStaffing") ?? 0,
            Color = team.GetOptionalString("Color"),
            CanManage = team.GetBoolean("CanManage", true)
        };

        if (settings is { } teamSettings)
        {
            summary.TeamLeadUserId = await _directory.ResolveGraphUserIdAsync(teamSettings.GetLookupId(People.TeamLead)) ?? string.Empty;
            summary.DefaultApproverUserId = await _directory.ResolveGraphUserIdAsync(teamSettings.GetLookupId(People.DefaultApprover)) ?? string.Empty;
            summary.BackupApproverUserId = await _directory.ResolveGraphUserIdAsync(teamSettings.GetLookupId("BackupApproverPerson"));
            summary.AllowUserOverride = teamSettings.GetBoolean("AllowUserOverride", true);
            summary.OutlookSyncPolicy = teamSettings.GetString("OutlookSyncPolicy", "optional");
        }

        return summary;
    }

    private static TeamAdminMemberDto ToMemberDto(
        AssignmentRow assignment,
        List<AssignmentRow> allAssignments,
        Dictionary<string, TeamMembershipDto> membersByUserId)
    {
        var graphMember = membersByUserId.GetValueOrDefault(assignment.UserId)?.Member;

        var userAssignments = allAssignments
            .Where(row => string.Equals(row.UserId, assignment.UserId, StringComparison.OrdinalIgnoreCase))
            .ToList();

        return new TeamAdminMemberDto
        {
            UserId = assignment.UserId,
            DisplayName = graphMember?.DisplayName ?? string.Empty,
            Email = graphMember?.Mail ?? string.Empty,
            PrimaryTeamId = userAssignments.FirstOrDefault(row => row.IsPrimary)?.TeamId ?? assignment.TeamId,
            AdditionalTeamIds = userAssignments.Where(row => !row.IsPrimary).Select(row => row.TeamId).ToList(),
            EmploymentPercentage = assignment.EmploymentPercentage,
            VacationBalance = assignment.VacationBalance,
            ApprovalExempt = assignment.ApprovalExempt,
            EffectiveApproverUserId = assignment.EffectiveApproverUserId
        };
    }

    private sealed record AssignmentRow(
        string UserId,
        string TeamId,
        bool IsPrimary,
        decimal EmploymentPercentage,
        decimal VacationBalance,
        bool ApprovalExempt,
        string? EffectiveApproverUserId);

    // --- Query plumbing ------------------------------------------------------

    /// <summary>
    /// Reads a list, following <c>@odata.nextLink</c> to the end.
    ///
    /// SharePoint pages server-side at 5000 items regardless of <c>$top</c>, and the entry tier is
    /// sized so a list stays under that (about 100 people, published with the retention). Paging is
    /// still followed rather than assumed away, because a site that grows past it must return
    /// complete data, not a silently truncated first page.
    /// </summary>
    private async Task<List<SharePointListItem>> QueryAsync(
        string listName,
        string select,
        string? filter = null,
        string? orderBy = null,
        int top = PageSize,
        CancellationToken cancellationToken = default)
    {
        var query = new List<string>
        {
            $"$select={Uri.EscapeDataString(select)}",
            $"$top={top}"
        };

        if (!string.IsNullOrWhiteSpace(filter))
        {
            query.Add($"$filter={Uri.EscapeDataString(filter)}");
        }

        if (!string.IsNullOrWhiteSpace(orderBy))
        {
            query.Add($"$orderby={Uri.EscapeDataString(orderBy)}");
        }

        var path = $"/_api/web/lists/getbytitle('{Uri.EscapeDataString(listName.Replace("'", "''"))}')/items?{string.Join("&", query)}";

        var items = new List<SharePointListItem>();
        var page = await _client.GetAsync<ListItemsResponse>(path, cancellationToken);

        while (page is not null)
        {
            foreach (var element in page.Value ?? [])
            {
                items.Add(new SharePointListItem(element));
            }

            if (string.IsNullOrWhiteSpace(page.NextLink))
            {
                break;
            }

            page = await _client.GetAbsoluteAsync<ListItemsResponse>(page.NextLink, cancellationToken);
        }

        return items;
    }

    private sealed class ListItemsResponse
    {
        public List<JsonElement>? Value { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("@odata.nextLink")]
        public string? NextLink { get; set; }
    }

    /// <summary>
    /// Escapes a value for an OData string literal. Every caller-supplied string reaching a filter
    /// goes through this — a status or team id arrives from request input, and an unescaped quote
    /// there would rewrite the filter rather than fail it.
    /// </summary>
    private static string Literal(string value) => $"'{value.Replace("'", "''")}'";

    private static string Iso(DateTime value) => value.ToString("yyyy-MM-ddTHH:mm:ssZ");

    private static string? And(IReadOnlyCollection<string> filters) =>
        filters.Count == 0 ? null : string.Join(" and ", filters);

    private static async Task<List<TResult>> MapAsync<TResult>(
        IEnumerable<SharePointListItem> items,
        Func<SharePointListItem, Task<TResult>> map)
    {
        var mapped = new List<TResult>();

        foreach (var item in items)
        {
            mapped.Add(await map(item));
        }

        return mapped;
    }

    private static PlanningResponse<T> Wrap<T>(List<T> items) =>
        new() { Items = items, TotalCount = items.Count };

    private static PlanningResponse<T> Empty<T>() => new() { Items = [], TotalCount = 0 };

    // --- Writes: delivery stage 2 -------------------------------------------

    /// <summary>
    /// EO-430 delivery stage 2. Writes need the item ETag and <c>If-Match</c> (FR-430.13), the
    /// unresolvable-person rule (FR-430.12) and compound-key enforcement (FR-430.6). Throwing keeps
    /// a half-built provider honest: a save that quietly did nothing is the failure this avoids.
    /// </summary>
    private static NotSupportedException NotYetWritable(string operation) =>
        new($"'{operation}' is not implemented in the SharePoint planning store yet (EO-430, delivery stage 2). " +
            "The read path is complete; writes arrive with ETag concurrency and compound-key enforcement.");

    public Task<AbsenceDto> SaveAbsenceAsync(AbsenceDto absence) => throw NotYetWritable(nameof(SaveAbsenceAsync));

    public Task DeleteAbsenceAsync(string id) => throw NotYetWritable(nameof(DeleteAbsenceAsync));

    public Task<VacationRequestDto> SaveVacationRequestAsync(VacationRequestDto request) => throw NotYetWritable(nameof(SaveVacationRequestAsync));

    public Task DeleteVacationRequestAsync(string id) => throw NotYetWritable(nameof(DeleteVacationRequestAsync));

    public Task<VacationRequestDto?> ApplyApprovalDecisionAsync(ApprovalCallbackDto callback) => throw NotYetWritable(nameof(ApplyApprovalDecisionAsync));

    public Task<ApprovalOptionsDto> GetApprovalOptionsAsync(
        string owningTeamId,
        string? employeeId,
        IReadOnlyCollection<TeamMembershipDto> graphMembers)
    {
        var firstOwnerId = graphMembers
            .Where(member => member.Member.IsOwner && !string.IsNullOrWhiteSpace(member.Member.Id))
            .Select(member => member.Member.Id)
            .FirstOrDefault();

        var candidates = graphMembers
            .Where(member => !string.IsNullOrWhiteSpace(member.Member.Id))
            .Where(member =>
                string.IsNullOrWhiteSpace(employeeId)
                || !string.Equals(member.Member.Id, employeeId, StringComparison.OrdinalIgnoreCase))
            .GroupBy(member => member.Member.Id, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Select(member => new ApprovalCandidateDto
            {
                UserId = member.Member.Id,
                DisplayName = string.IsNullOrWhiteSpace(member.Member.DisplayName)
                    ? member.Member.Id
                    : member.Member.DisplayName
            })
            .OrderBy(candidate => candidate.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        return Task.FromResult(new ApprovalOptionsDto
        {
            DefaultApproverUserId = firstOwnerId,
            AllowOverride = true,
            ApprovalExempt = false,
            Candidates = candidates
        });
    }

    public Task<OrgConfigDto> SaveOrgConfigAsync(OrgConfigPatchDto patch) => throw NotYetWritable(nameof(SaveOrgConfigAsync));

    public Task<PlanningResponse<PublicHoliday>> ReplacePublicHolidaysAsync(IReadOnlyCollection<PublicHoliday> holidays) => throw NotYetWritable(nameof(ReplacePublicHolidaysAsync));

    public Task<DisplayConfigDto> SaveDisplayConfigAsync(DisplayConfigPatchDto patch) => throw NotYetWritable(nameof(SaveDisplayConfigAsync));

    public Task<MailboxSyncConfigDto> SaveMailboxSyncConfigAsync(MailboxSyncConfigPatchDto patch) => throw NotYetWritable(nameof(SaveMailboxSyncConfigAsync));

    public Task<TeamAdminDetailsDto> SaveTeamAdminChangesAsync(TeamAdminSaveRequestDto saveRequest, string? owningTeamId = null) => throw NotYetWritable(nameof(SaveTeamAdminChangesAsync));
    public Task<int> RemoveMemberFromHostAsync(string userId, string? owningTeamId = null) => throw NotYetWritable(nameof(RemoveMemberFromHostAsync));

    public Task<TeamAdminTeamSummaryDto> CreateTeamAsync(TeamCreateRequestDto request) => throw NotYetWritable(nameof(CreateTeamAsync));

    public Task<PlanningResponse<TeamAdminTeamSummaryDto>> UpdateTeamsAsync(TeamsUpdateRequestDto request, string? owningTeamId = null) => throw NotYetWritable(nameof(UpdateTeamsAsync));

    public Task DeleteTeamAsync(string teamId, string? owningTeamId = null) => throw NotYetWritable(nameof(DeleteTeamAsync));

    // EO-454: Holiday calendar slot configuration (not yet implemented for SharePoint store)
    public Task<IReadOnlyCollection<HolidayCalendarSlot>> GetHolidayCalendarSlotsAsync(string teamId) => throw NotYetWritable(nameof(GetHolidayCalendarSlotsAsync));

    public Task<IReadOnlyCollection<HolidayCalendarSlot>> UpdateHolidayCalendarSlotsAsync(string teamId, IReadOnlyCollection<HolidayCalendarSlot> slots) => throw NotYetWritable(nameof(UpdateHolidayCalendarSlotsAsync));
}
