using Microsoft.EntityFrameworkCore;
using RppWebApi.Models;
using RppWebApi.Services;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace RppWebApi.Data;

/// <summary>
/// EF Core implementation of IPlanningRepository.
/// Uses the same interface as the mock repository.
/// </summary>
public class EfPlanningRepository : IPlanningRepository
{
    private readonly RppDbContext _context;
    private readonly GraphTeamMembershipService _graphService;
    private readonly ILogger<EfPlanningRepository> _logger;

    // EO-456: one gate per M365 host so concurrent first paints cannot create two default teams.
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> DefaultTeamSeedLocks =
        new(StringComparer.OrdinalIgnoreCase);

    public EfPlanningRepository(
        RppDbContext context, 
        GraphTeamMembershipService graphService,
        ILogger<EfPlanningRepository> logger)
    {
        _context = context;
        _graphService = graphService;
        _logger = logger;
    }

    public async Task<PlanningResponse<AbsenceDto>> GetAbsencesAsync(string? employeeId = null, int? year = null, string? status = null)
    {
        var query = _context.Absences.AsQueryable();

        if (!string.IsNullOrEmpty(employeeId))
            query = query.Where(a => a.EmployeeId == employeeId);

        if (year.HasValue)
            query = query.Where(a => a.StartDate.Year == year.Value || a.EndDate.Year == year.Value);

        if (!string.IsNullOrEmpty(status))
            query = query.Where(a => a.Status == status);

        var items = await query.ToListAsync();

        return new PlanningResponse<AbsenceDto>
        {
            Items = items,
            TotalCount = items.Count
        };
    }

    public async Task<AbsenceDto> SaveAbsenceAsync(AbsenceDto absence)
    {
        if (string.IsNullOrEmpty(absence.Id))
        {
            absence.Id = $"abs-{Guid.NewGuid().ToString()[..12]}";
        }

        // EO-458 / Host Europe: Npgsql requires UTC for timestamptz; JSON dates arrive Unspecified.
        absence.StartDate = PostgresDateTime.AsUtcDate(absence.StartDate);
        absence.EndDate = PostgresDateTime.AsUtcDate(absence.EndDate);
        absence.Created = PostgresDateTime.AsUtcInstant(absence.Created == default ? DateTime.UtcNow : absence.Created);
        absence.Modified = DateTime.UtcNow;

        // Guard column limits (Substitute is display name; long names must not 500 the write).
        if (absence.Id.Length > 50)
        {
            absence.Id = absence.Id[..50];
        }

        if (absence.Substitute is { Length: > 100 })
        {
            absence.Substitute = absence.Substitute[..100];
        }

        if (absence.Comment is { Length: > 500 })
        {
            absence.Comment = absence.Comment[..500];
        }

        if (string.IsNullOrWhiteSpace(absence.Source))
        {
            absence.Source = "manual";
        }

        if (string.IsNullOrWhiteSpace(absence.Status))
        {
            absence.Status = "approved";
        }

        if (string.IsNullOrWhiteSpace(absence.ApprovalStatus))
        {
            absence.ApprovalStatus = "draft";
        }

        // Upsert: the frontend generates absence ids client-side, so a non-empty id
        // does NOT imply the row exists (plain Update caused DbUpdateConcurrencyException).
        var existing = await _context.Absences
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.Id == absence.Id);

        if (existing is null)
        {
            _context.Absences.Add(absence);
        }
        else
        {
            absence.Created = existing.Created.Kind == DateTimeKind.Unspecified
                ? PostgresDateTime.AsUtcInstant(existing.Created)
                : existing.Created;
            _context.Entry(existing).CurrentValues.SetValues(absence);
        }

        try
        {
            await _context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "SaveAbsenceAsync failed id={Id} employee={EmployeeId} start={Start} end={End} startKind={StartKind} endKind={EndKind} createdKind={CreatedKind}",
                absence.Id,
                absence.EmployeeId,
                absence.StartDate,
                absence.EndDate,
                absence.StartDate.Kind,
                absence.EndDate.Kind,
                absence.Created.Kind);
            throw;
        }

        return absence;
    }

    public async Task DeleteAbsenceAsync(string id)
    {
        var absence = await _context.Absences.FindAsync(id);
        if (absence != null)
        {
            absence.Status = "deleted"; // Soft delete
            await _context.SaveChangesAsync();
        }
    }

    public async Task<PlanningResponse<VacationBalanceDto>> GetVacationBalancesAsync(string? employeeId = null, int? year = null)
    {
        var query = _context.VacationBalances.AsQueryable();

        if (!string.IsNullOrEmpty(employeeId))
            query = query.Where(b => b.EmployeeId == employeeId);

        if (year.HasValue)
            query = query.Where(b => b.Year == year.Value);

        var items = await query.ToListAsync();

        return new PlanningResponse<VacationBalanceDto>
        {
            Items = items,
            TotalCount = items.Count
        };
    }

    public Task<PlanningResponse<PlanningEventDto>> GetPlanningEventsAsync(string? employeeId = null)
    {
        // TODO: Implement when PlanningEvents table is fully modeled
        return Task.FromResult(new PlanningResponse<PlanningEventDto> { Items = new List<PlanningEventDto>() });
    }

    public Task<object> GetPlanningSettingsAsync()
    {
        // TODO: Load from database or configuration table
        return Task.FromResult<object>(new
        {
            planningHorizonMonths = 3,
            defaultView = "timeline",
            enableApprovalWorkflow = true,
            enableOutlookSync = true
        });
    }

    public Task<PlanningResponse<object>> GetTeamConfigurationsAsync()
    {
        // TODO: Implement TeamConfiguration entity
        return Task.FromResult(new PlanningResponse<object> { Items = new List<object>() });
    }

    // === EO-416: persisted holiday calendar ===

    public async Task<PlanningResponse<PublicHoliday>> GetPublicHolidaysAsync()
    {
        var items = await _context.PublicHolidays
            .OrderBy(h => h.Date)
            .ThenBy(h => h.Location)
            .ToListAsync();

        return new PlanningResponse<PublicHoliday> { Items = items, TotalCount = items.Count };
    }

    public async Task<PlanningResponse<PublicHoliday>> ReplacePublicHolidaysAsync(IReadOnlyCollection<PublicHoliday> holidays)
    {
        var cleaned = holidays
            .Where(h => !string.IsNullOrWhiteSpace(h.Date) && !string.IsNullOrWhiteSpace(h.Label))
            .GroupBy(h => $"{h.Date}|{h.Location ?? "default"}|{h.Label}")
            .Select(group => group.First())
            .ToList();

        cleaned.ForEach(h => h.Id = $"hol-{Guid.NewGuid().ToString("N")[..10]}");

        _context.PublicHolidays.RemoveRange(_context.PublicHolidays);
        await _context.SaveChangesAsync();

        _context.PublicHolidays.AddRange(cleaned);
        await _context.SaveChangesAsync();

        return await GetPublicHolidaysAsync();
    }

    // === EO-410: vacation request lifecycle + approval decision writeback ===

    public async Task<PlanningResponse<VacationRequestDto>> GetVacationRequestsAsync(string? status = null, string? userId = null, string? requestId = null, string? teamId = null)
    {
        var query = _context.VacationRequests.AsQueryable();

        if (!string.IsNullOrEmpty(requestId))
            query = query.Where(r => r.Id == requestId);

        if (!string.IsNullOrEmpty(userId))
            query = query.Where(r => r.EmployeeId == userId);

        if (!string.IsNullOrEmpty(status))
            query = query.Where(r => r.Status == status);

        if (!string.IsNullOrEmpty(teamId))
        {
            // EO-420: callers pass the M365 host-group id (EO-419 team scoping), while
            // requests may store internal planning team ids, the host id, or (legacy) the
            // display name when Team Admin cache was cold at submit time.
            var hostTeams = await _context.Teams.AsNoTracking()
                .Where(t => t.OwningTeamId == teamId || t.TeamId == teamId)
                .Select(t => new { t.TeamId, t.TeamName, t.OwningTeamId })
                .ToListAsync();

            var scopedTeamIds = hostTeams.Select(t => t.TeamId).ToList();
            var scopedNames = hostTeams
                .Select(t => t.TeamName)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .ToList();
            var owningIds = hostTeams
                .Select(t => t.OwningTeamId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            query = query.Where(r =>
                r.TeamId == teamId
                || scopedTeamIds.Contains(r.TeamId)
                || scopedNames.Contains(r.TeamId)
                || owningIds.Contains(r.TeamId));
        }

        var items = await query.OrderByDescending(r => r.Modified).ToListAsync();

        return new PlanningResponse<VacationRequestDto>
        {
            Items = items,
            TotalCount = items.Count
        };
    }

    public async Task<VacationRequestDto> SaveVacationRequestAsync(VacationRequestDto request)
    {
        if (string.IsNullOrEmpty(request.Id))
        {
            request.Id = $"vacation-request-{Guid.NewGuid().ToString()[..12]}";
        }

        // EO-458 / Host Europe: JSON deserializes date-only fields as Kind=Unspecified.
        // SQL Server accepts that; PostgreSQL timestamptz rejects it with HTTP 500 on save —
        // which surfaced as "Genehmigung … (HTTP 500)" on the first draft write.
        request.StartDate = PostgresDateTime.AsUtcDate(request.StartDate);
        request.EndDate = PostgresDateTime.AsUtcDate(request.EndDate);
        request.DecisionDate = PostgresDateTime.AsUtcInstant(request.DecisionDate);
        request.Modified = DateTime.UtcNow;

        // IgnoreQueryFilters: an update must also reach rows whose current status is
        // filtered out globally (e.g. re-submitting after cancellation).
        var existing = await _context.VacationRequests
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.Id == request.Id);

        if (existing is null)
        {
            request.Created = DateTime.UtcNow;
            _context.VacationRequests.Add(request);
        }
        else
        {
            request.Created = existing.Created.Kind == DateTimeKind.Unspecified
                ? PostgresDateTime.AsUtcInstant(existing.Created)
                : existing.Created;
            _context.Entry(existing).CurrentValues.SetValues(request);
        }

        await _context.SaveChangesAsync();
        return request;
    }

    public async Task DeleteVacationRequestAsync(string id)
    {
        var request = await _context.VacationRequests.IgnoreQueryFilters().FirstOrDefaultAsync(r => r.Id == id);

        if (request != null)
        {
            request.Status = "cancelled"; // soft delete, mirrors the global query filter
            request.Modified = DateTime.UtcNow;
            await _context.SaveChangesAsync();
        }
    }

    public async Task<VacationRequestDto?> ApplyApprovalDecisionAsync(ApprovalCallbackDto callback)
    {
        var request = await _context.VacationRequests
            .FirstOrDefaultAsync(r => r.Id == callback.RequestId && r.Status == "pendingApproval");

        if (request is null || !string.Equals(request.ApprovalReferenceId, callback.ApprovalReferenceId, StringComparison.Ordinal))
        {
            _logger.LogWarning(
                "Approval callback could not be matched to a pending vacation request (RequestId={RequestId}).",
                callback.RequestId);
            return null;
        }

        var approved = string.Equals(callback.Decision, "approved", StringComparison.OrdinalIgnoreCase);
        request.Status = approved ? "approved" : "rejected";
        request.DecisionBy = callback.DecisionBy;
        request.DecisionDate = DateTime.TryParse(callback.DecisionDate, out var decisionDate) ? decisionDate.ToUniversalTime() : DateTime.UtcNow;
        request.DecisionComment = callback.DecisionComment;
        request.FlowRunId = string.IsNullOrWhiteSpace(callback.FlowRunId) ? request.FlowRunId : callback.FlowRunId;
        request.Modified = DateTime.UtcNow;

        // The absence saved at submission time is linked via VacationRequestId; update it
        // instead of duplicating. Only when no linked row exists an approved decision
        // creates a fresh absence so the Timeline reflects the outcome either way.
        var linkedAbsence = await _context.Absences.FirstOrDefaultAsync(a => a.VacationRequestId == request.Id);

        if (linkedAbsence is not null)
        {
            linkedAbsence.ApprovalStatus = request.Status;
            linkedAbsence.Modified = DateTime.UtcNow;
        }
        else if (approved)
        {
            _context.Absences.Add(new AbsenceDto
            {
                Id = $"abs-{Guid.NewGuid().ToString()[..12]}",
                EmployeeId = request.EmployeeId,
                Type = request.Type,
                StartDate = request.StartDate,
                StartHalf = request.StartHalf,
                EndDate = request.EndDate,
                EndHalf = request.EndHalf,
                Duration = request.Duration,
                Comment = request.Comment,
                Status = "approved",
                ApprovalStatus = "approved",
                VacationRequestId = request.Id,
                Created = DateTime.UtcNow,
                Modified = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync();
        return request;
    }

    public async Task<ApprovalOptionsDto> GetApprovalOptionsAsync(
        string owningTeamId,
        string? employeeId,
        IReadOnlyCollection<TeamMembershipDto> graphMembers)
    {
        await EnsureDefaultPlanningTeamAsync(owningTeamId);

        var teams = await _context.Teams
            .AsNoTracking()
            .Include(team => team.Settings)
            .Where(team => team.OwningTeamId == owningTeamId)
            .OrderBy(team => team.SortOrder)
            .ThenBy(team => team.TeamName)
            .ToListAsync();

        var teamIds = teams.Select(team => team.TeamId).ToList();
        var assignments = teamIds.Count == 0
            ? new List<TeamAdminMemberAssignment>()
            : await _context.MemberAssignments
                .AsNoTracking()
                .Where(row => teamIds.Contains(row.TeamId))
                .ToListAsync();

        TeamAdminTeam? primaryTeam = null;
        TeamAdminMemberAssignment? primaryAssignment = null;

        if (!string.IsNullOrWhiteSpace(employeeId))
        {
            primaryAssignment = assignments
                .Where(row => string.Equals(row.UserId, employeeId, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(row => row.IsPrimary)
                .FirstOrDefault();

            if (primaryAssignment is not null)
            {
                primaryTeam = teams.FirstOrDefault(team =>
                    string.Equals(team.TeamId, primaryAssignment.TeamId, StringComparison.OrdinalIgnoreCase));
            }
        }

        primaryTeam ??= teams.FirstOrDefault();

        var settings = primaryTeam?.Settings;
        var firstOwnerId = graphMembers
            .Where(member => member.Member.IsOwner && !string.IsNullOrWhiteSpace(member.Member.Id))
            .Select(member => member.Member.Id)
            .FirstOrDefault();

        // Prefer member-level override, then team default, then team lead, then first M365 owner.
        // EO-456 seeds empty DefaultApproverUserId — without this fallback the form shows "–"
        // and submission fails with an opaque client error.
        var defaultApprover =
            FirstNonEmpty(
                primaryAssignment?.EffectiveApproverUserId,
                settings?.DefaultApproverUserId,
                settings?.TeamLeadUserId,
                firstOwnerId);

        var approvalExempt = primaryAssignment?.ApprovalExempt == true;
        var allowOverride = settings?.AllowUserOverride ?? true;

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

        return new ApprovalOptionsDto
        {
            DefaultApproverUserId = defaultApprover,
            AllowOverride = allowOverride,
            ApprovalExempt = approvalExempt,
            Candidates = candidates
        };
    }

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return null;
    }

    public async Task<IReadOnlyList<string>> ListAssignedUserIdsAsync()
    {
        return await _context.MemberAssignments
            .AsNoTracking()
            .Select(row => row.UserId)
            .Where(userId => userId != null && userId != "")
            .Distinct()
            .ToListAsync();
    }

    public async Task<PlanningResponse<TeamMembershipDto>> GetTeamMembershipsAsync(string? pageToken = null, string? teamId = null)
    {
        // EO-456: first scoped use of a host without internal RPP teams seeds "Alle - {name}".
        if (!string.IsNullOrWhiteSpace(teamId))
        {
            await EnsureDefaultPlanningTeamAsync(teamId);
        }

        // Now calls real Microsoft Graph via the dedicated service (EO-406 completed).
        // This replaces all previous mock data with live M365 group members.
        var teams = await _context.Teams.AsNoTracking().ToListAsync();
        var assignments = await _context.MemberAssignments
            .AsNoTracking()
            .OrderBy(row => row.UserId)
            .ThenBy(row => row.TeamId)
            .ThenByDescending(row => row.IsPrimary)
            .ToListAsync();
        var graphMembers = await _graphService.GetRealTeamMembersAsync(teamId);
        var graphMembersByUserId = graphMembers
            .Where(member => !string.IsNullOrWhiteSpace(member.Member?.Id))
            .GroupBy(member => member.Member.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var teamNamesByTeamId = teams.ToDictionary(
            team => team.TeamId,
            team => team.TeamName,
            StringComparer.OrdinalIgnoreCase);

        // EO-420: the caller passes the M365 host-group id (X-RPP-Active-TeamId), while
        // assignments reference internal planning team ids. Resolve the host scope via
        // OwningTeamId; accept an internal team id too so direct team filters keep working.
        var scopedTeamIds = string.IsNullOrWhiteSpace(teamId)
            ? null
            : teams
                .Where(team => string.Equals(team.OwningTeamId, teamId, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(team.TeamId, teamId, StringComparison.OrdinalIgnoreCase))
                .Select(team => team.TeamId)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var members = assignments
            .Where(row => scopedTeamIds == null || scopedTeamIds.Contains(row.TeamId))
            .Where(row => teamNamesByTeamId.ContainsKey(row.TeamId))
            .GroupBy(row => new { row.UserId, row.TeamId, row.IsPrimary })
            .Select(group => BuildMembershipDto(group.First(), teamNamesByTeamId[group.First().TeamId], graphMembersByUserId))
            .ToList();

        // EO-415: resolve raw Graph profile values through the configured mappings.
        await ResolveOrgLocationAsync(members);

        return new PlanningResponse<TeamMembershipDto>
        {
            Items = members,
            TotalCount = members.Count,
            NextPageToken = null
        };
    }

    // === EO-415: configurable organisations, locations and profile value mappings ===

    public async Task<OrgConfigDto> GetOrgConfigAsync()
    {
        await EnsureOrgConfigSeedAsync();

        var organisations = await _context.Organisations.OrderBy(o => o.SortOrder).ToListAsync();
        var locations = await _context.Locations.OrderBy(l => l.SortOrder).ToListAsync();
        var mappings = await _context.ProfileValueMappings.ToListAsync();

        var members = await _graphService.GetRealTeamMembersAsync();
        var mappedOrgValues = mappings.Where(m => m.Kind == "organisation").Select(m => m.GraphValue).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var mappedLocationValues = mappings.Where(m => m.Kind == "location").Select(m => m.GraphValue).ToHashSet(StringComparer.OrdinalIgnoreCase);

        return new OrgConfigDto
        {
            Organisations = organisations,
            Locations = locations,
            Mappings = mappings,
            UnmappedOrganisationValues = members
                .Select(m => m.Member.RawOrganizationValue)
                .Where(value => !string.IsNullOrWhiteSpace(value) && !mappedOrgValues.Contains(value!))
                .Select(value => value!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(value => value)
                .ToList(),
            UnmappedLocationValues = members
                .Select(m => m.Member.RawLocationValue)
                .Where(value => !string.IsNullOrWhiteSpace(value) && !mappedLocationValues.Contains(value!))
                .Select(value => value!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(value => value)
                .ToList()
        };
    }

    public async Task<OrgConfigDto> SaveOrgConfigAsync(OrgConfigPatchDto patch)
    {
        if (patch.Organisations.Any(o => string.IsNullOrWhiteSpace(o.Name)) || patch.Locations.Any(l => string.IsNullOrWhiteSpace(l.Name)))
        {
            throw new InvalidOperationException("orgConfigNameRequired");
        }

        var organisationIds = patch.Organisations.Select(o => o.Id).ToHashSet();
        var locationIds = patch.Locations.Select(l => l.Id).ToHashSet();
        var validMappings = patch.Mappings
            .Where(m => !string.IsNullOrWhiteSpace(m.GraphValue))
            .Where(m => m.Kind == "organisation" ? organisationIds.Contains(m.TargetId) : locationIds.Contains(m.TargetId))
            .ToList();

        patch.Organisations.Where(o => string.IsNullOrEmpty(o.Id)).ToList()
            .ForEach(o => o.Id = $"org-{Guid.NewGuid().ToString("N")[..8]}");
        patch.Locations.Where(l => string.IsNullOrEmpty(l.Id)).ToList()
            .ForEach(l => l.Id = $"loc-{Guid.NewGuid().ToString("N")[..8]}");
        validMappings.Where(m => string.IsNullOrEmpty(m.Id)).ToList()
            .ForEach(m => m.Id = $"map-{Guid.NewGuid().ToString("N")[..8]}");

        _context.Organisations.RemoveRange(_context.Organisations);
        _context.Locations.RemoveRange(_context.Locations);
        _context.ProfileValueMappings.RemoveRange(_context.ProfileValueMappings);
        await _context.SaveChangesAsync();

        _context.Organisations.AddRange(patch.Organisations);
        _context.Locations.AddRange(patch.Locations);
        _context.ProfileValueMappings.AddRange(validMappings);
        await _context.SaveChangesAsync();

        // Mapped names are resolved on read; drop the member cache so changes show up now.
        GraphTeamMembershipService.InvalidateCache();

        return await GetOrgConfigAsync();
    }

    // === EO-421: tenant-wide display settings (single row) ===

    public async Task<DisplayConfigDto> GetDisplayConfigAsync()
    {
        var settings = await _context.DisplaySettings.FindAsync(PlanningDisplaySettings.SingletonId);

        return new DisplayConfigDto
        {
            ShowVacationSummary = settings?.ShowVacationSummary ?? true,
            EventColorMode = NormalizeEventColorMode(settings?.EventColorMode)
        };
    }

    public async Task<DisplayConfigDto> SaveDisplayConfigAsync(DisplayConfigPatchDto patch)
    {
        var settings = await _context.DisplaySettings.FindAsync(PlanningDisplaySettings.SingletonId);

        if (settings is null)
        {
            settings = new PlanningDisplaySettings();
            _context.DisplaySettings.Add(settings);
        }

        settings.ShowVacationSummary = patch.ShowVacationSummary ?? settings.ShowVacationSummary;
        settings.EventColorMode = NormalizeEventColorMode(patch.EventColorMode ?? settings.EventColorMode);
        settings.LastModified = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return new DisplayConfigDto
        {
            ShowVacationSummary = settings.ShowVacationSummary,
            EventColorMode = settings.EventColorMode
        };
    }

    private static string NormalizeEventColorMode(string? value)
    {
        return value == "byTeam" ? "byTeam" : "byType";
    }

    // === EO-425: mailbox sync configuration (single row) ===

    public async Task<MailboxSyncConfigDto> GetMailboxSyncConfigAsync()
    {
        var config = await _context.MailboxSyncConfigs.FindAsync(MailboxSyncConfig.SingletonId);
        return new MailboxSyncConfigDto { MailboxAddress = config?.MailboxAddress ?? string.Empty };
    }

    public async Task<MailboxSyncConfigDto> SaveMailboxSyncConfigAsync(MailboxSyncConfigPatchDto patch)
    {
        var config = await _context.MailboxSyncConfigs.FindAsync(MailboxSyncConfig.SingletonId);

        if (config is null)
        {
            config = new MailboxSyncConfig();
            _context.MailboxSyncConfigs.Add(config);
        }

        if (patch.MailboxAddress is not null)
        {
            config.MailboxAddress = patch.MailboxAddress.Trim();
        }

        config.LastModified = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return new MailboxSyncConfigDto { MailboxAddress = config.MailboxAddress };
    }

    private async Task EnsureOrgConfigSeedAsync()
    {
        if (await _context.Organisations.AnyAsync() || await _context.Locations.AnyAsync())
        {
            return;
        }

        _context.Organisations.Add(new PlanningOrganisation { Id = "org-partner", Name = "Partnerorganisation", SortOrder = 0 });
        _context.Locations.AddRange(
            new PlanningLocation { Id = "loc-duebendorf", Name = "Dübendorf", SortOrder = 0 },
            new PlanningLocation { Id = "loc-st-gallen", Name = "St. Gallen", SortOrder = 1 },
            new PlanningLocation { Id = "loc-thun", Name = "Thun", SortOrder = 2 });
        await _context.SaveChangesAsync();
    }

    private async Task ResolveOrgLocationAsync(IReadOnlyCollection<TeamMembershipDto> members)
    {
        await EnsureOrgConfigSeedAsync();

        var organisationNames = await _context.Organisations.ToDictionaryAsync(o => o.Id, o => o.Name);
        var locationNames = await _context.Locations.ToDictionaryAsync(l => l.Id, l => l.Name);
        var mappings = await _context.ProfileValueMappings.ToListAsync();

        string Resolve(string kind, string? rawValue, IReadOnlyDictionary<string, string> names)
        {
            if (string.IsNullOrWhiteSpace(rawValue))
            {
                return "";
            }

            var mapping = mappings.FirstOrDefault(m => m.Kind == kind && string.Equals(m.GraphValue, rawValue, StringComparison.OrdinalIgnoreCase));

            return mapping is not null && names.TryGetValue(mapping.TargetId, out var name) ? name : rawValue;
        }

        foreach (var membership in members)
        {
            membership.Member.Organization = Resolve("organisation", membership.Member.RawOrganizationValue, organisationNames);
            membership.Member.Location = Resolve("location", membership.Member.RawLocationValue, locationNames);
        }
    }

    private static TeamMembershipDto BuildMembershipDto(
        TeamAdminMemberAssignment assignment,
        string teamName,
        IReadOnlyDictionary<string, TeamMembershipDto> graphMembersByUserId)
    {
        var member = graphMembersByUserId.TryGetValue(assignment.UserId, out var graphMember)
            ? graphMember.Member
            : new TeamMemberDto
            {
                Id = assignment.UserId,
                DisplayName = assignment.UserId,
                Mail = string.Empty,
                Initials = CreateInitials(assignment.UserId),
                Organization = string.Empty,
                Location = string.Empty,
                IsGuest = false,
                IsOwner = false
            };

        return new TeamMembershipDto
        {
            Id = $"mship-{assignment.Id}",
            Member = new TeamMemberDto
            {
                Id = member.Id,
                DisplayName = member.DisplayName,
                Mail = member.Mail,
                Initials = member.Initials,
                Organization = member.Organization,
                Location = member.Location,
                RawOrganizationValue = member.RawOrganizationValue,
                RawLocationValue = member.RawLocationValue,
                IsGuest = member.IsGuest,
                IsOwner = member.IsOwner
            },
            TeamId = assignment.TeamId,
            TeamName = teamName,
            IsPrimary = assignment.IsPrimary
        };
    }

    private static string CreateInitials(string value)
    {
        var parts = value.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);

        if (parts.Length == 0)
        {
            return "??";
        }

        if (parts.Length == 1)
        {
            return parts[0].Length >= 2 ? parts[0][..2].ToUpperInvariant() : parts[0].ToUpperInvariant();
        }

        return string.Concat(parts[0][0], parts[^1][0]).ToUpperInvariant();
    }

    // === EO-408: Team Admin Center - Normalized SQL Persistence ===

    public const string AllTeamsId = "__all-teams";

    // EO-419: internal teams are owned by one M365 host team. An empty owningTeamId
    // (local development / auth bypass) falls back to the unscoped view.
    private static List<TeamAdminTeam> ScopeTeams(IEnumerable<TeamAdminTeam> teams, string? owningTeamId)
    {
        return string.IsNullOrWhiteSpace(owningTeamId)
            ? teams.ToList()
            : teams.Where(t => string.Equals(t.OwningTeamId, owningTeamId, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    public async Task<PlanningResponse<TeamAdminTeamSummaryDto>> GetManagedTeamsAsync(string? owningTeamId = null)
    {
        // EO-456: Team Admin first paint must also seed so owners are not sent to an empty create card.
        if (!string.IsNullOrWhiteSpace(owningTeamId))
        {
            await EnsureDefaultPlanningTeamAsync(owningTeamId);
        }

        var teams = ScopeTeams(
            await _context.Teams
                .Include(t => t.Settings)
                .OrderBy(t => t.SortOrder)
                .ThenBy(t => t.TeamName)
                .ToListAsync(),
            owningTeamId);
        var scopedTeamIds = teams.Select(t => t.TeamId).ToHashSet();
        var assignments = (await _context.MemberAssignments.ToListAsync())
            .Where(row => scopedTeamIds.Contains(row.TeamId))
            .ToList();

        var items = teams.Select(team => ToTeamSummary(team, assignments)).ToList();

        _logger.LogInformation("Loaded {Count} managed teams from database (owningTeamId={OwningTeamId})", items.Count, owningTeamId ?? "-");

        return new PlanningResponse<TeamAdminTeamSummaryDto>
        {
            Items = items,
            TotalCount = items.Count
        };
    }

    public async Task<TeamAdminDetailsDto> GetTeamAdminDetailsAsync(string teamId, string? owningTeamId = null)
    {
        var teams = ScopeTeams(
            await _context.Teams
                .Include(t => t.Settings)
                .OrderBy(t => t.SortOrder)
                .ThenBy(t => t.TeamName)
                .ToListAsync(),
            owningTeamId);
        var scopedTeamIds = teams.Select(t => t.TeamId).ToHashSet();
        var assignments = (await _context.MemberAssignments.ToListAsync())
            .Where(row => scopedTeamIds.Contains(row.TeamId))
            .ToList();
        var absenceTypes = await _context.AbsenceEntryTypes.OrderBy(t => t.SortOrder).ToListAsync();
        // EO-419: the assignable people are the members of the HOST team context.
        var graphMembers = await _graphService.GetRealTeamMembersAsync(owningTeamId);

        var isAllTeams = teamId == AllTeamsId;
        var team = isAllTeams
            ? teams.FirstOrDefault()
            : teams.FirstOrDefault(t => t.TeamId == teamId);

        if (team == null)
        {
            throw new KeyNotFoundException($"Team {teamId} was not found.");
        }

        var allMembers = BuildMemberDtos(graphMembers, assignments);
        // Only people with at least one host-scoped assignment belong in the members table.
        // Graph-only people (no RPP assignment) stay in assignableMembers so "remove from
        // planning" does not leave them visible under an empty/default team or as a raw OID.
        var assignedMembers = allMembers.Where(HasPlanningAssignment).ToList();
        var members = isAllTeams
            ? assignedMembers
            : assignedMembers.Where(member => IsAssignedToTeam(member, team.TeamId)).ToList();
        var assignableMembers = isAllTeams
            ? allMembers.Where(member => !HasPlanningAssignment(member)).ToList()
            : allMembers.Where(member => !IsAssignedToTeam(member, team.TeamId)).ToList();

        var summary = ToTeamSummary(team, assignments);

        if (isAllTeams)
        {
            summary = new TeamAdminTeamSummaryDto
            {
                TeamId = AllTeamsId,
                TeamName = "All Teams",
                Organization = summary.Organization,
                SortOrder = 0,
                RequiredStaffing = 0,
                CanManage = true,
                MemberCount = assignedMembers.Count,
                TeamLeadUserId = summary.TeamLeadUserId,
                DefaultApproverUserId = summary.DefaultApproverUserId,
                BackupApproverUserId = summary.BackupApproverUserId,
                AllowUserOverride = summary.AllowUserOverride,
                OutlookSyncPolicy = summary.OutlookSyncPolicy
            };
        }

        return new TeamAdminDetailsDto
        {
            Team = summary,
            AllowedApprovers = allMembers
                .Select(member => new TeamAdminPersonDto
                {
                    UserId = member.UserId,
                    DisplayName = member.DisplayName,
                    Email = member.Email
                })
                .OrderBy(person => person.DisplayName)
                .ToList(),
            Members = members,
            AssignableMembers = assignableMembers,
            AbsenceEntryTypes = absenceTypes.Select(entry => new TeamAdminAbsenceEntryTypeDto
            {
                Key = entry.Key,
                Label = entry.Label,
                LabelKey = entry.LabelKey,
                Active = entry.Active,
                RequiresApproval = entry.RequiresApproval,
                ConsumesVacationBalance = entry.ConsumesVacationBalance
            }).ToList(),
            TeamOptions = teams.Select(t => new TeamAdminTeamOptionDto
            {
                TeamId = t.TeamId,
                TeamName = t.TeamName
            }).ToList(),
            CanEdit = team.CanManage
        };
    }

    public async Task<TeamAdminDetailsDto> SaveTeamAdminChangesAsync(TeamAdminSaveRequestDto saveRequest, string? owningTeamId = null)
    {
        var isAllTeams = saveRequest.TeamId == AllTeamsId;
        var scopedTeams = ScopeTeams(await _context.Teams.ToListAsync(), owningTeamId);
        var knownTeamIds = new HashSet<string>(scopedTeams.Select(t => t.TeamId), StringComparer.OrdinalIgnoreCase);

        if (!isAllTeams)
        {
            var settingsRow = await _context.TeamSettings.FirstOrDefaultAsync(s => s.TeamId == saveRequest.TeamId);

            if (!knownTeamIds.Contains(saveRequest.TeamId))
            {
                throw new KeyNotFoundException($"Team {saveRequest.TeamId} was not found.");
            }

            if (saveRequest.Settings != null)
            {
                if (settingsRow == null)
                {
                    settingsRow = new TeamAdminSettings { TeamId = saveRequest.TeamId };
                    _context.TeamSettings.Add(settingsRow);
                }

                settingsRow.TeamLeadUserId = saveRequest.Settings.TeamLeadUserId;
                settingsRow.DefaultApproverUserId = saveRequest.Settings.DefaultApproverUserId;
                settingsRow.BackupApproverUserId = string.IsNullOrWhiteSpace(saveRequest.Settings.BackupApproverUserId)
                    ? null
                    : saveRequest.Settings.BackupApproverUserId;
                settingsRow.AllowUserOverride = saveRequest.Settings.AllowUserOverride;
                settingsRow.OutlookSyncPolicy = NormalizePolicy(saveRequest.Settings.OutlookSyncPolicy);
                settingsRow.LastModified = DateTime.UtcNow;
            }
        }

        // Last write wins per user. The client may send an upsert and a later remove for the
        // same person in one PATCH; without collapsing, a remove could miss rows just staged
        // as Added in this same SaveChanges unit of work.
        var patchesByUserId = new Dictionary<string, TeamAdminMemberAssignmentPatchDto>(StringComparer.OrdinalIgnoreCase);
        foreach (var patch in saveRequest.MemberAssignments)
        {
            if (string.IsNullOrWhiteSpace(patch.UserId))
            {
                continue;
            }

            patch.UserId = NormalizeEntraObjectId(patch.UserId);
            if (string.IsNullOrWhiteSpace(patch.UserId))
            {
                continue;
            }

            patchesByUserId[patch.UserId] = patch;
        }

        // Load host-scoped rows once; match user ids case-insensitively so remove patches
        // still delete rows when Graph OID casing differs from stored values.
        var hostAssignmentRows = (await _context.MemberAssignments
                .Where(row => row.UserId != null)
                .ToListAsync())
            .Where(row => knownTeamIds.Contains(row.TeamId))
            .ToList();

        foreach (var patch in patchesByUserId.Values)
        {
            var patchUserId = patch.UserId;

            // EO-419: only rewrite the user's assignments within the host scope — the
            // same person may have assignments in other host teams' internal teams.
            // Empty primary + no additional = full unassign: delete every row for this user
            // in the DB (same as DELETE members/{userId}), not only host-scoped rows.
            var additionalTeamIds = (patch.AdditionalTeamIds ?? new List<string>())
                .Where(id => knownTeamIds.Contains(id)
                    && !string.Equals(id, patch.PrimaryTeamId, StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var hasPrimary = !string.IsNullOrWhiteSpace(patch.PrimaryTeamId) && knownTeamIds.Contains(patch.PrimaryTeamId);
            var isFullRemove = !hasPrimary && additionalTeamIds.Count == 0;

            var existingRows = isFullRemove
                ? (await _context.MemberAssignments.ToListAsync())
                    .Where(row => string.Equals(
                        NormalizeEntraObjectId(row.UserId),
                        patchUserId,
                        StringComparison.OrdinalIgnoreCase))
                    .ToList()
                : hostAssignmentRows
                    .Where(row => string.Equals(
                        NormalizeEntraObjectId(row.UserId),
                        patchUserId,
                        StringComparison.OrdinalIgnoreCase))
                    .ToList();
            _context.MemberAssignments.RemoveRange(existingRows);
            hostAssignmentRows.RemoveAll(row =>
                string.Equals(NormalizeEntraObjectId(row.UserId), patchUserId, StringComparison.OrdinalIgnoreCase));

            if (hasPrimary)
            {
                var primaryRow = CreateAssignmentRow(patch, patch.PrimaryTeamId, isPrimary: true);
                _context.MemberAssignments.Add(primaryRow);
                hostAssignmentRows.Add(primaryRow);
            }

            var isFirstRow = !hasPrimary;

            foreach (var additionalTeamId in additionalTeamIds)
            {
                // Profile fields live on the primary row; without one they go to the first additional row.
                var additionalRow = isFirstRow
                    ? CreateAssignmentRow(patch, additionalTeamId, isPrimary: false)
                    : new TeamAdminMemberAssignment
                    {
                        UserId = patchUserId,
                        TeamId = additionalTeamId,
                        IsPrimary = false,
                        EmploymentPercentage = null,
                        VacationBalance = 0,
                        LastModified = DateTime.UtcNow
                    };
                _context.MemberAssignments.Add(additionalRow);
                hostAssignmentRows.Add(additionalRow);
                isFirstRow = false;
            }

            if (isFullRemove)
            {
                _logger.LogInformation(
                    "TeamAdmin removed all assignments for user {UserId} ({RemovedCount} rows)",
                    patchUserId,
                    existingRows.Count);
            }
        }

        if (saveRequest.AbsenceEntryTypes != null)
        {
            var existingTypes = await _context.AbsenceEntryTypes.ToListAsync();
            _context.AbsenceEntryTypes.RemoveRange(existingTypes);

            var sortOrder = 0;

            foreach (var entry in saveRequest.AbsenceEntryTypes)
            {
                if (string.IsNullOrWhiteSpace(entry.Key))
                {
                    continue;
                }

                _context.AbsenceEntryTypes.Add(new TeamAdminAbsenceType
                {
                    Key = entry.Key,
                    Label = entry.Label,
                    LabelKey = entry.LabelKey,
                    Active = entry.Active,
                    RequiresApproval = entry.RequiresApproval,
                    ConsumesVacationBalance = entry.ConsumesVacationBalance,
                    SortOrder = sortOrder,
                    LastModified = DateTime.UtcNow
                });
                sortOrder += 1;
            }
        }

        await _context.SaveChangesAsync();

        _logger.LogInformation("TeamAdmin changes persisted for team {TeamId} ({MemberCount} member patches)",
            saveRequest.TeamId, saveRequest.MemberAssignments.Count);

        return await GetTeamAdminDetailsAsync(saveRequest.TeamId, owningTeamId);
    }

    /// <summary>
    /// Deletes every assignment row for <paramref name="userId"/> (case-insensitive, GUID braces ignored).
    /// Team Admin "remove from planning" is intentional full unassign for this installation DB —
    /// host filtering previously left orphans visible when OwningTeamId did not match the header.
    /// </summary>
    public async Task<int> RemoveMemberFromHostAsync(string userId, string? owningTeamId = null)
    {
        if (string.IsNullOrWhiteSpace(userId))
        {
            return 0;
        }

        var normalizedUserId = NormalizeEntraObjectId(userId);
        var userRows = (await _context.MemberAssignments.ToListAsync())
            .Where(row => string.Equals(NormalizeEntraObjectId(row.UserId), normalizedUserId, StringComparison.OrdinalIgnoreCase))
            .ToList();

        _context.MemberAssignments.RemoveRange(userRows);
        await _context.SaveChangesAsync();

        _logger.LogInformation(
            "TeamAdmin hard-removed {Count} assignment row(s) for user {UserId} (host={OwningTeamId})",
            userRows.Count,
            normalizedUserId,
            owningTeamId ?? "-");
        return userRows.Count;
    }

    private static string NormalizeEntraObjectId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        return value.Trim().Trim('{', '}');
    }

    public async Task<TeamAdminTeamSummaryDto> CreateTeamAsync(TeamCreateRequestDto request)
    {
        var teamName = request.TeamName.Trim();

        if (string.IsNullOrWhiteSpace(teamName))
        {
            throw new InvalidOperationException("teamNameRequired");
        }

        var existingTeams = await _context.Teams.ToListAsync();
        var scopedTeams = ScopeTeams(existingTeams, request.SourceTeamId);

        if (scopedTeams.Any(team => string.Equals(team.TeamName, teamName, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("teamNameDuplicate");
        }

        var team = new TeamAdminTeam
        {
            TeamId = CreateTeamId(teamName, existingTeams.Select(t => t.TeamId)),
            TeamName = teamName,
            Organization = request.Organization ?? "",
            // EO-419: the new internal team belongs to the host team it was created from.
            OwningTeamId = request.SourceTeamId ?? "",
            SortOrder = scopedTeams.Count == 0 ? 1 : scopedTeams.Max(t => t.SortOrder) + 1,
            RequiredStaffing = 1,
            CanManage = true,
            Settings = new TeamAdminSettings
            {
                TeamLeadUserId = string.Empty,
                DefaultApproverUserId = string.Empty,
                ApprovalPolicy = "optional",
                OutlookSyncPolicy = "optional",
                AllowUserOverride = true
            }
        };
        team.Settings.TeamId = team.TeamId;

        _context.Teams.Add(team);
        await _context.SaveChangesAsync();

        _logger.LogInformation("Created team {TeamId} ({TeamName})", team.TeamId, team.TeamName);

        return ToTeamSummary(team, Array.Empty<TeamAdminMemberAssignment>());
    }

    public async Task<PlanningResponse<TeamAdminTeamSummaryDto>> UpdateTeamsAsync(TeamsUpdateRequestDto request, string? owningTeamId = null)
    {
        var teams = ScopeTeams(await _context.Teams.Include(t => t.Settings).ToListAsync(), owningTeamId);

        foreach (var row in request.Teams)
        {
            var team = teams.FirstOrDefault(t => t.TeamId == row.TeamId);

            if (team == null)
            {
                continue;
            }

            var teamName = row.TeamName.Trim();

            if (string.IsNullOrWhiteSpace(teamName))
            {
                throw new InvalidOperationException("teamNameRequired");
            }

            var isDuplicate = teams.Any(other =>
                other.TeamId != row.TeamId &&
                string.Equals(other.TeamName, teamName, StringComparison.OrdinalIgnoreCase) &&
                request.Teams.All(updated => updated.TeamId != other.TeamId || string.Equals(updated.TeamName.Trim(), teamName, StringComparison.OrdinalIgnoreCase)));

            if (isDuplicate && teams.Any(other => other.TeamId != row.TeamId && string.Equals(other.TeamName, teamName, StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException("teamNameDuplicate");
            }

            team.TeamName = teamName;
            team.Organization = string.IsNullOrWhiteSpace(row.Organization) ? team.Organization : row.Organization;
            team.SortOrder = row.SortOrder;
            team.RequiredStaffing = Math.Max(0, row.RequiredStaffing);
            team.Color = string.IsNullOrWhiteSpace(row.Color) ? null : row.Color;
            team.LastModified = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync();

        return await GetManagedTeamsAsync(owningTeamId);
    }

    public async Task DeleteTeamAsync(string teamId, string? owningTeamId = null)
    {
        var team = ScopeTeams(await _context.Teams.Where(t => t.TeamId == teamId).ToListAsync(), owningTeamId).FirstOrDefault();

        if (team == null)
        {
            throw new KeyNotFoundException($"Team {teamId} was not found.");
        }

        var hasAssignments = await _context.MemberAssignments.AnyAsync(row => row.TeamId == teamId);

        if (hasAssignments)
        {
            throw new InvalidOperationException("teamHasMembers");
        }

        _context.Teams.Remove(team);
        await _context.SaveChangesAsync();

        _logger.LogInformation("Deleted team {TeamId}", teamId);
    }

    private static TeamAdminTeamSummaryDto ToTeamSummary(TeamAdminTeam team, IReadOnlyCollection<TeamAdminMemberAssignment> assignments)
    {
        return new TeamAdminTeamSummaryDto
        {
            TeamId = team.TeamId,
            TeamName = team.TeamName,
            Organization = team.Organization,
            SortOrder = team.SortOrder,
            RequiredStaffing = team.RequiredStaffing,
            Color = team.Color,
            CanManage = team.CanManage,
            MemberCount = assignments
                .Where(row => row.TeamId == team.TeamId)
                .Select(row => row.UserId)
                .Distinct()
                .Count(),
            TeamLeadUserId = team.Settings?.TeamLeadUserId ?? string.Empty,
            DefaultApproverUserId = team.Settings?.DefaultApproverUserId ?? string.Empty,
            BackupApproverUserId = team.Settings?.BackupApproverUserId,
            AllowUserOverride = team.Settings?.AllowUserOverride ?? true,
            OutlookSyncPolicy = NormalizePolicy(team.Settings?.OutlookSyncPolicy)
        };
    }

    private static List<TeamAdminMemberDto> BuildMemberDtos(
        IReadOnlyCollection<TeamMembershipDto> graphMembers,
        IReadOnlyCollection<TeamAdminMemberAssignment> assignments)
    {
        var assignmentsByUserId = assignments
            .GroupBy(row => row.UserId)
            .ToDictionary(group => group.Key, group => group.ToList());
        var members = new Dictionary<string, TeamAdminMemberDto>();

        foreach (var graphMember in graphMembers)
        {
            var userId = graphMember.Member?.Id ?? string.Empty;

            if (string.IsNullOrWhiteSpace(userId) || members.ContainsKey(userId))
            {
                continue;
            }

            members[userId] = new TeamAdminMemberDto
            {
                UserId = userId,
                DisplayName = graphMember.Member?.DisplayName ?? userId,
                Email = graphMember.Member?.Mail ?? string.Empty
            };
        }

        // Users with persisted assignments that are no longer part of the Graph team stay visible.
        foreach (var userId in assignmentsByUserId.Keys)
        {
            if (!members.ContainsKey(userId))
            {
                members[userId] = new TeamAdminMemberDto
                {
                    UserId = userId,
                    DisplayName = userId,
                    Email = string.Empty
                };
            }
        }

        foreach (var member in members.Values)
        {
            if (!assignmentsByUserId.TryGetValue(member.UserId, out var rows))
            {
                continue;
            }

            var primaryRow = rows.FirstOrDefault(row => row.IsPrimary);
            var profileRow = primaryRow ?? rows.OrderBy(row => row.Id).FirstOrDefault();

            member.PrimaryTeamId = primaryRow?.TeamId ?? string.Empty;
            member.AdditionalTeamIds = rows
                .Where(row => !row.IsPrimary)
                .Select(row => row.TeamId)
                .Distinct()
                .ToList();

            if (profileRow != null)
            {
                member.EmploymentPercentage = profileRow.EmploymentPercentage;
                member.VacationBalance = profileRow.VacationBalance;
                member.ApprovalExempt = profileRow.ApprovalExempt;
                member.EffectiveApproverUserId = profileRow.EffectiveApproverUserId;
            }
        }

        return members.Values.OrderBy(member => member.DisplayName).ToList();
    }

    private static bool HasPlanningAssignment(TeamAdminMemberDto member)
    {
        return !string.IsNullOrWhiteSpace(member.PrimaryTeamId) || member.AdditionalTeamIds.Count > 0;
    }

    private static bool IsAssignedToTeam(TeamAdminMemberDto member, string teamId)
    {
        return string.Equals(member.PrimaryTeamId, teamId, StringComparison.OrdinalIgnoreCase)
            || member.AdditionalTeamIds.Any(id => string.Equals(id, teamId, StringComparison.OrdinalIgnoreCase));
    }

    private static TeamAdminMemberAssignment CreateAssignmentRow(
        TeamAdminMemberAssignmentPatchDto patch,
        string teamId,
        bool isPrimary)
    {
        return new TeamAdminMemberAssignment
        {
            UserId = patch.UserId,
            TeamId = teamId,
            IsPrimary = isPrimary,
            EmploymentPercentage = patch.EmploymentPercentage,
            VacationBalance = patch.VacationBalance,
            ApprovalExempt = patch.ApprovalExempt,
            EffectiveApproverUserId = string.IsNullOrWhiteSpace(patch.EffectiveApproverUserId)
                ? null
                : patch.EffectiveApproverUserId,
            LastModified = DateTime.UtcNow
        };
    }

    private static string NormalizePolicy(string? value)
    {
        return value == "mandatory" || value == "disabled" ? value : "optional";
    }

    private static string CreateTeamId(string teamName, IEnumerable<string> existingIds)
    {
        var idBase = new string(teamName
            .ToLowerInvariant()
            .Normalize(System.Text.NormalizationForm.FormD)
            .Where(character => char.IsLetterOrDigit(character) || character == ' ' || character == '-')
            .ToArray())
            .Trim()
            .Replace(' ', '-');

        if (string.IsNullOrWhiteSpace(idBase))
        {
            idBase = "team";
        }

        var ids = new HashSet<string>(existingIds);
        var teamId = idBase;
        var suffix = 2;

        while (ids.Contains(teamId))
        {
            teamId = $"{idBase}-{suffix}";
            suffix += 1;
        }

        return teamId;
    }

    // === EO-454: Team-level holiday calendar slot configuration ===

    public async Task<IReadOnlyCollection<HolidayCalendarSlot>> GetHolidayCalendarSlotsAsync(string teamId)
    {
        _logger.LogInformation("EfPlanningRepository.GetHolidayCalendarSlotsAsync for team {TeamId}", teamId);
        var slots = await _context.HolidayCalendarSlots
            .Where(s => s.TeamId == teamId)
            .ToListAsync();

        return slots.AsReadOnly();
    }

    public async Task<IReadOnlyCollection<HolidayCalendarSlot>> UpdateHolidayCalendarSlotsAsync(string teamId, IReadOnlyCollection<HolidayCalendarSlot> slots)
    {
        _logger.LogInformation("EfPlanningRepository.UpdateHolidayCalendarSlotsAsync for team {TeamId} ({Count} slots)", teamId, slots.Count);

        // Remove existing slots for this team
        var existingSlots = await _context.HolidayCalendarSlots
            .Where(s => s.TeamId == teamId)
            .ToListAsync();

        _context.HolidayCalendarSlots.RemoveRange(existingSlots);

        // Add new slots
        var newSlots = slots.Select(s => new HolidayCalendarSlot
        {
            Id = s.Id,
            TeamId = teamId,
            Kind = s.Kind,
            Enabled = s.Enabled,
            DisplayLabel = s.DisplayLabel,
            Tone = s.Tone,
            SourceType = s.SourceType,
            SourceUrl = s.SourceUrl,
            MicrosoftPreset = s.MicrosoftPreset,
            LastModified = DateTime.UtcNow
        }).ToList();

        _context.HolidayCalendarSlots.AddRange(newSlots);
        await _context.SaveChangesAsync();

        return newSlots.AsReadOnly();
    }

    // === EO-424: inbound Outlook mailbox sync — lookup helpers ===

    public async Task<AbsenceDto?> GetAbsenceByIcsUidAsync(string icsUid)
    {
        if (string.IsNullOrWhiteSpace(icsUid))
            return null;

        return await _context.Absences
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.IcsUid == icsUid && a.Status != "deleted");
    }

    public async Task<List<AbsenceDto>> GetAbsencesByEmployeeAndDateRangeAsync(
        string employeeId, DateTime startDate, DateTime endDate)
    {
        return await _context.Absences
            .Where(a => a.EmployeeId == employeeId
                        && a.StartDate <= endDate
                        && a.EndDate >= startDate)
            .ToListAsync();
    }

    /// <summary>
    /// EO-456 / ADR-005: when an M365 host has zero internal RPP teams, create
    /// <c>Alle - {displayName}</c> and primary-assign every Graph member and guest.
    /// Graph outages must not leave an empty sticky structure that blocks a later seed.
    /// </summary>
    internal async Task EnsureDefaultPlanningTeamAsync(string owningTeamId)
    {
        if (string.IsNullOrWhiteSpace(owningTeamId))
        {
            return;
        }

        if (await _context.Teams.AsNoTracking().AnyAsync(team => team.OwningTeamId == owningTeamId))
        {
            return;
        }

        var seedLock = DefaultTeamSeedLocks.GetOrAdd(owningTeamId, static _ => new SemaphoreSlim(1, 1));
        await seedLock.WaitAsync();

        try
        {
            if (await _context.Teams.AnyAsync(team => team.OwningTeamId == owningTeamId))
            {
                return;
            }

            List<TeamMembershipDto> graphMembers;
            try
            {
                graphMembers = await _graphService.GetRealTeamMembersAsync(owningTeamId, throwOnFailure: true);
            }
            catch (GraphUnavailableException ex)
            {
                // Fail closed for structure creation: an empty default team would mark the host as
                // structured and prevent a successful seed on the next request (FR-456.3).
                _logger.LogWarning(
                    ex,
                    "EO-456: skipped default team seed for host {OwningTeamId} because Graph is unavailable.",
                    owningTeamId);
                return;
            }

            var displayName = await _graphService.GetTeamDisplayNameAsync(owningTeamId);
            var teamName = BuildDefaultTeamName(displayName, owningTeamId);
            var existingIds = await _context.Teams.AsNoTracking().Select(team => team.TeamId).ToListAsync();
            var internalTeamId = CreateTeamId(teamName, existingIds);

            var team = new TeamAdminTeam
            {
                TeamId = internalTeamId,
                TeamName = teamName,
                Organization = "",
                OwningTeamId = owningTeamId,
                SortOrder = 1,
                RequiredStaffing = 1,
                CanManage = true,
                LastModified = DateTime.UtcNow,
                Settings = new TeamAdminSettings
                {
                    TeamId = internalTeamId,
                    // Prefer the first M365 owner so vacation requests have a real default
                    // approver immediately after seed (empty DefaultApprover broke submissions).
                    TeamLeadUserId = graphMembers
                        .Where(member => member.Member.IsOwner && !string.IsNullOrWhiteSpace(member.Member.Id))
                        .Select(member => member.Member.Id)
                        .FirstOrDefault() ?? string.Empty,
                    DefaultApproverUserId = graphMembers
                        .Where(member => member.Member.IsOwner && !string.IsNullOrWhiteSpace(member.Member.Id))
                        .Select(member => member.Member.Id)
                        .FirstOrDefault() ?? string.Empty,
                    ApprovalPolicy = "optional",
                    OutlookSyncPolicy = "optional",
                    AllowUserOverride = true
                }
            };

            _context.Teams.Add(team);

            // TeamAdminMemberAssignments enforces at most one primary row per user globally
            // (filtered unique index on UserId where IsPrimary = 1). Users who already have a
            // primary team in another host must join this default cohort as non-primary, otherwise
            // SaveChanges throws and both /memberships and /teamadmin/teams return HTTP 500.
            var usersWithPrimary = (await _context.MemberAssignments.AsNoTracking()
                    .Where(row => row.IsPrimary)
                    .Select(row => row.UserId)
                    .ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var assignedUserIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var primaryCount = 0;
            var secondaryCount = 0;
            foreach (var membership in graphMembers)
            {
                var userId = membership.Member?.Id;
                if (string.IsNullOrWhiteSpace(userId) || !assignedUserIds.Add(userId))
                {
                    continue;
                }

                var asPrimary = !usersWithPrimary.Contains(userId);
                if (asPrimary)
                {
                    primaryCount += 1;
                    usersWithPrimary.Add(userId);
                }
                else
                {
                    secondaryCount += 1;
                }

                _context.MemberAssignments.Add(new TeamAdminMemberAssignment
                {
                    UserId = userId,
                    TeamId = internalTeamId,
                    IsPrimary = asPrimary,
                    EmploymentPercentage = 100,
                    VacationBalance = 25,
                    ApprovalExempt = false,
                    LastModified = DateTime.UtcNow
                });
            }

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                // Roll back the tracked graph so a failed seed does not poison the ambient context
                // for the remainder of the request (memberships/managed-teams still need to read).
                foreach (var entry in _context.ChangeTracker.Entries().ToList())
                {
                    entry.State = EntityState.Detached;
                }

                _logger.LogError(
                    ex,
                    "EO-456: failed to seed default planning team for host {OwningTeamId}.",
                    owningTeamId);
                throw;
            }

            _logger.LogInformation(
                "EO-456: seeded default planning team {TeamId} ({TeamName}) for host {OwningTeamId} with {MemberCount} assignments ({PrimaryCount} primary, {SecondaryCount} non-primary).",
                internalTeamId,
                teamName,
                owningTeamId,
                assignedUserIds.Count,
                primaryCount,
                secondaryCount);
        }
        finally
        {
            seedLock.Release();
        }
    }

    internal static string BuildDefaultTeamName(string? m365DisplayName, string owningTeamId)
    {
        var trimmed = string.IsNullOrWhiteSpace(m365DisplayName)
            ? null
            : Regex.Replace(m365DisplayName.Trim(), @"\s+", " ");

        if (!string.IsNullOrWhiteSpace(trimmed))
        {
            return $"Alle - {trimmed}";
        }

        // Stable host hint when Graph cannot resolve the display name (still not a customer hardcode).
        var suffix = owningTeamId.Length <= 8 ? owningTeamId : owningTeamId[^8..];
        return $"Alle - Team {suffix}";
    }
}