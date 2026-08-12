using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Identity.Web.Resource;
using RppWebApi.Models;
using RppWebApi.Services;
using System.Security.Claims;
using System.Collections.Generic;

namespace RppWebApi.Controllers;

/// <summary>
/// Main API endpoint for all planning data.
/// Returns realistic data matching the current frontend mock state.
/// This allows the Timeline, Team Capacity, My Absences, and Approval pages to work with the "api" provider.
/// </summary>
[ApiController]
[Route("api/planning")]
[Authorize]   // EO-405: Entra ID bearer tokens required; local development bypass via ApiSettings:RequireAuthentication=false
[RequiredScope(RequiredScopesConfigurationKey = "AzureAd:Scopes")]
public class PlanningController : ControllerBase
{
    private const string AllTeamsId = "__all-teams";
    private const int ApprovalStatusConcurrency = 4;

    private readonly IPlanningRepository _repository;
    private readonly GraphTeamMembershipService _graphService;
    private readonly ApprovalFlowService _approvalFlowService;
    private readonly IGraphApprovalService _graphApprovalService;
    private readonly OutlookCalendarSyncService _outlookSyncService;
    private readonly UserPhotoService _userPhotoService;
    private readonly AppAdminSettings _appAdminSettings;
    private readonly GraphSettings _graphSettings;
    private readonly ILogger<PlanningController> _logger;

    public PlanningController(
        IPlanningRepository repository,
        GraphTeamMembershipService graphService,
        ApprovalFlowService approvalFlowService,
        IGraphApprovalService graphApprovalService,
        OutlookCalendarSyncService outlookSyncService,
        UserPhotoService userPhotoService,
        Microsoft.Extensions.Options.IOptions<AppAdminSettings> appAdminSettings,
        Microsoft.Extensions.Options.IOptions<GraphSettings> graphSettings,
        ILogger<PlanningController> logger)
    {
        _repository = repository;
        _graphService = graphService;
        _approvalFlowService = approvalFlowService;
        _graphApprovalService = graphApprovalService;
        _outlookSyncService = outlookSyncService;
        _userPhotoService = userPhotoService;
        _appAdminSettings = appAdminSettings.Value;
        _graphSettings = graphSettings.Value;
        _logger = logger;
    }

    // Health check remains public (handled in HealthController)
    // Absences
    [HttpGet("absences")]
    public async Task<ActionResult<PlanningResponse<AbsenceDto>>> GetAbsences(
        [FromQuery] string? employeeId = null,
        [FromQuery] int? year = null,
        [FromQuery] string? status = null,
        [FromQuery] string? teamId = null)
    {
        _logger.LogInformation("GET /api/planning/absences - employeeId={EmployeeId}, year={Year}, teamId={TeamId}", employeeId, year, teamId);

        // EO-459: team-scoped read — same gate as memberships, then filter to team members.
        var (readContext, readError) = await EnsureTeamMemberReadAsync(teamId);
        if (readError is not null)
        {
            return readError;
        }

        if (!string.IsNullOrWhiteSpace(employeeId) && !readContext!.AllowedUserIds.Contains(employeeId))
        {
            return Ok(new PlanningResponse<AbsenceDto> { Items = new List<AbsenceDto>(), TotalCount = 0 });
        }

        var result = await _repository.GetAbsencesAsync(employeeId, year, status);
        return Ok(FilterPlanningPage(result, item => item.EmployeeId, readContext!.AllowedUserIds));
    }

    [HttpPost("absences")]
    public async Task<ActionResult<AbsenceDto>> SaveAbsence([FromBody] AbsenceDto absence)
    {
        _logger.LogInformation("POST /api/planning/absences for {EmployeeId} id={Id}", absence.EmployeeId, absence.Id);

        // EO-418 + EO-459: self or owner of active team; owner/self-with-team require membership rules.
        var writeError = await EvaluateWriteAccessAsync(absence.EmployeeId, "Absence write");
        if (writeError is not null)
        {
            return writeError;
        }

        try
        {
            var result = await _repository.SaveAbsenceAsync(absence);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "POST /api/planning/absences failed for {EmployeeId} id={Id}.", absence.EmployeeId, absence.Id);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                code = "absenceSaveFailed",
                message = "The absence could not be saved."
            });
        }
    }

    [HttpDelete("absences/{id}")]
    public async Task<IActionResult> DeleteAbsence(string id)
    {
        _logger.LogInformation("DELETE /api/planning/absences/{Id}", id);

        // EO-418 + EO-459: resolve the row, then the same write gate (no unfiltered trust).
        var stored = await _repository.GetAbsencesAsync();
        var target = stored.Items.FirstOrDefault(a => a.Id == id);

        if (target is null)
        {
            await _repository.DeleteAbsenceAsync(id);
            return NoContent();
        }

        var writeError = await EvaluateWriteAccessAsync(target.EmployeeId, "Absence delete");
        if (writeError is not null)
        {
            return writeError;
        }

        await _repository.DeleteAbsenceAsync(id);
        return NoContent();
    }

    // Vacation Balances
    [HttpGet("vacationbalances")]
    public async Task<ActionResult<PlanningResponse<VacationBalanceDto>>> GetVacationBalances(
        [FromQuery] string? employeeId = null,
        [FromQuery] int? year = null,
        [FromQuery] string? teamId = null)
    {
        _logger.LogInformation("GET /api/planning/vacationbalances - teamId={TeamId}", teamId);

        var (readContext, readError) = await EnsureTeamMemberReadAsync(teamId);
        if (readError is not null)
        {
            return readError;
        }

        if (!string.IsNullOrWhiteSpace(employeeId) && !readContext!.AllowedUserIds.Contains(employeeId))
        {
            return Ok(new PlanningResponse<VacationBalanceDto> { Items = new List<VacationBalanceDto>(), TotalCount = 0 });
        }

        var result = await _repository.GetVacationBalancesAsync(employeeId, year);
        return Ok(FilterPlanningPage(result, item => item.EmployeeId, readContext!.AllowedUserIds));
    }

    // Planning Events (Training, Maintenance, OnCall, etc.)
    [HttpGet("events")]
    public async Task<ActionResult<PlanningResponse<PlanningEventDto>>> GetPlanningEvents(
        [FromQuery] string? employeeId = null,
        [FromQuery] string? teamId = null)
    {
        _logger.LogInformation("GET /api/planning/events - teamId={TeamId}", teamId);

        var (readContext, readError) = await EnsureTeamMemberReadAsync(teamId);
        if (readError is not null)
        {
            return readError;
        }

        if (!string.IsNullOrWhiteSpace(employeeId) && !readContext!.AllowedUserIds.Contains(employeeId))
        {
            return Ok(new PlanningResponse<PlanningEventDto> { Items = new List<PlanningEventDto>(), TotalCount = 0 });
        }

        var result = await _repository.GetPlanningEventsAsync(employeeId);
        return Ok(FilterPlanningPage(result, item => item.EmployeeId, readContext!.AllowedUserIds));
    }

    // Settings & Team Configuration
    [HttpGet("settings")]
    public async Task<ActionResult<object>> GetPlanningSettings()
    {
        _logger.LogInformation("GET /api/planning/settings");
        var result = await _repository.GetPlanningSettingsAsync();
        return Ok(result);
    }

    [HttpGet("teamconfigurations")]
    public async Task<ActionResult<PlanningResponse<object>>> GetTeamConfigurations()
    {
        _logger.LogInformation("GET /api/planning/teamconfigurations");
        var result = await _repository.GetTeamConfigurationsAsync();
        return Ok(result);
    }

    // === EO-410: Vacation Requests (Genehmigungen / Approvals) ===
    [HttpGet("vacationrequests")]
    public async Task<ActionResult<PlanningResponse<VacationRequestDto>>> GetVacationRequests(
        [FromQuery] string? status = null,
        [FromQuery] string? userId = null,
        [FromQuery] string? requestId = null,
        [FromQuery] string? teamId = null)
    {
        _logger.LogInformation("GET /api/planning/vacationrequests - status={Status}, userId={UserId}, teamId={TeamId}", status, userId, teamId);

        // Graph Approvals uses the caller's delegated OBO token, so reconciliation must stay in
        // the request context. The status reads are bounded and parallel rather than a linear
        // chain; repository writes remain sequential because the scoped EF context is not thread-safe.
        if (_graphApprovalService.IsEnabled)
        {
            await SyncPendingGraphApprovalsAsync(teamId);
        }

        var result = await _repository.GetVacationRequestsAsync(status, userId, requestId, teamId);
        return Ok(result);
    }

    private async Task SyncPendingGraphApprovalsAsync(string? teamId = null)
    {
        var pending = await _repository.GetVacationRequestsAsync(status: "pendingApproval", teamId: teamId);
        var candidates = pending.Items
            .Where(item => !string.IsNullOrEmpty(item.ApprovalReferenceId))
            .Take(20)
            .ToList();
        var cancellationToken = HttpContext.RequestAborted;

        using var concurrencyGate = new SemaphoreSlim(ApprovalStatusConcurrency);
        var statusReads = candidates.Select(async request =>
        {
            await concurrencyGate.WaitAsync(cancellationToken);

            try
            {
                var status = await _graphApprovalService.GetApprovalStatusAsync(
                    request.ApprovalReferenceId!,
                    cancellationToken);
                return (Request: request, Status: status);
            }
            finally
            {
                concurrencyGate.Release();
            }
        });

        var statusResults = await Task.WhenAll(statusReads);

        foreach (var (request, approvalStatus) in statusResults)
        {

            if (approvalStatus is null)
            {
                continue;
            }

            if (string.Equals(approvalStatus.State, "completed", StringComparison.OrdinalIgnoreCase))
            {
                var decision = approvalStatus.IsApproved() ? "approved" : "rejected";
                _logger.LogInformation(
                    "Applying Graph approval decision for request {RequestId}: {Decision} (result={Result}, response={Response}).",
                    request.Id, decision, approvalStatus.Result ?? "-", approvalStatus.ResponseValue ?? "-");

                var decided = await _repository.ApplyApprovalDecisionAsync(new ApprovalCallbackDto
                {
                    RequestId = request.Id,
                    ApprovalReferenceId = request.ApprovalReferenceId!,
                    Decision = decision,
                    DecisionBy = approvalStatus.DecisionBy ?? string.Empty,
                    DecisionDate = approvalStatus.CompletedDateTime ?? DateTime.UtcNow.ToString("o"),
                    DecisionComment = approvalStatus.DecisionComment,
                    FlowRunId = "graph"
                });

                // EO-414: approved → upsert the calendar event; rejected → remove it.
                if (decided is not null && _outlookSyncService.IsEnabled)
                {
                    await _outlookSyncService.ApplyLifecycleAsync(decided, HttpContext.RequestAborted);
                    await _repository.SaveVacationRequestAsync(decided);
                }
            }
            else if (string.Equals(approvalStatus.State, "canceled", StringComparison.OrdinalIgnoreCase))
            {
                request.Status = "cancelled";
                await _outlookSyncService.ApplyLifecycleAsync(request, HttpContext.RequestAborted);
                await _repository.SaveVacationRequestAsync(request);
            }
        }
    }

    [HttpPost("vacationrequests")]
    public async Task<ActionResult<VacationRequestDto>> SaveVacationRequest([FromBody] VacationRequestDto request)
    {
        _logger.LogInformation("POST /api/planning/vacationrequests ({RequestId}, status={Status})", request.Id, request.Status);

        // EO-418 + EO-459: self or owner; owner/self-with-team require membership rules.
        var writeError = await EvaluateWriteAccessAsync(request.EmployeeId, "Vacation request write");
        if (writeError is not null)
        {
            return writeError;
        }

        try
        {
            var result = await _repository.SaveVacationRequestAsync(request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            // Surface a machine-readable code so the Timeline does not only show bare "HTTP 500".
            _logger.LogError(ex, "POST /api/planning/vacationrequests failed for {RequestId}.", request.Id);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                code = "vacationRequestSaveFailed",
                message = "The vacation request could not be saved."
            });
        }
    }

    /// <summary>
    /// Approval picker for the absence form. Any member of the active host team may call this —
    /// Team Admin details stay owner-gated, but every requester needs default approver + candidates.
    /// </summary>
    [HttpGet("approval-options")]
    public async Task<ActionResult<ApprovalOptionsDto>> GetApprovalOptions([FromQuery] string? employeeId = null)
    {
        var (requestedTeamId, origin) = ResolveTeamContext();
        _logger.LogInformation(
            "GET /api/planning/approval-options employeeId={EmployeeId} teamId={TeamId} origin={Origin}",
            employeeId, requestedTeamId, origin);

        if (string.IsNullOrWhiteSpace(requestedTeamId))
        {
            return NoTeamContext();
        }

        try
        {
            var currentUserId = GetCurrentUserObjectId();
            var graphMembers = await _graphService.GetRealTeamMembersAsync(requestedTeamId, throwOnFailure: true);

            if (!string.IsNullOrWhiteSpace(currentUserId)
                && !graphMembers.Any(m => string.Equals(m.Member.Id, currentUserId, StringComparison.OrdinalIgnoreCase)))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { code = "forbidden", message = "Not a member of the active team." });
            }

            var targetEmployeeId = string.IsNullOrWhiteSpace(employeeId) ? currentUserId : employeeId;
            var options = await _repository.GetApprovalOptionsAsync(requestedTeamId, targetEmployeeId, graphMembers);
            return Ok(options);
        }
        catch (GraphUnavailableException ex)
        {
            _logger.LogError(ex, "Approval options failed because Microsoft Graph did not answer for team {TeamId}.", requestedTeamId);
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                code = "membershipLookupFailed",
                message = "Team memberships could not be read from Microsoft Graph."
            });
        }
    }

    [HttpDelete("vacationrequests/{id}")]
    public async Task<IActionResult> DeleteVacationRequest(string id)
    {
        _logger.LogInformation("DELETE /api/planning/vacationrequests/{Id}", id);

        var stored = await _repository.GetVacationRequestsAsync(status: null, userId: null, requestId: id);
        var request = stored.Items.FirstOrDefault();

        await _repository.DeleteVacationRequestAsync(id);

        // EO-414: cancelled requests remove their linked calendar event.
        if (request is not null && _outlookSyncService.IsEnabled)
        {
            request.Status = "cancelled";
            await _outlookSyncService.ApplyLifecycleAsync(request, HttpContext.RequestAborted);
            await _repository.SaveVacationRequestAsync(request);
        }

        return NoContent();
    }

    /// <summary>
    /// EO-410: starts the Microsoft 365 approval for a stored vacation request.
    /// The Power Automate flow URL is called server-side; the SPA never sees it.
    /// </summary>
    [HttpPost("vacationrequests/{id}/start-approval")]
    public async Task<ActionResult<StartApprovalResponseDto>> StartApproval(string id, [FromBody] StartApprovalRequestDto input)
    {
        _logger.LogInformation("POST /api/planning/vacationrequests/{Id}/start-approval", id);

        if (!string.Equals(id, input.RequestId, StringComparison.Ordinal))
        {
            return BadRequest(new { code = "requestIdMismatch" });
        }

        if (string.IsNullOrWhiteSpace(input.ApproverId))
        {
            return BadRequest(new
            {
                code = "approverRequired",
                message = "An approver is required. Configure a default approver in the Team Admin Center or select one on the form."
            });
        }

        var stored = await _repository.GetVacationRequestsAsync(status: null, userId: null, requestId: id);
        var request = stored.Items.FirstOrDefault();

        if (request is null)
        {
            return NotFound();
        }

        StartApprovalResponseDto? output;

        if (_graphApprovalService.IsEnabled)
        {
            // EO-410 (Graph provider): create the Microsoft Approval directly via Graph
            // in the requester's delegated context; the approver decides in Teams.
            // Dates/day-halves are localized for the Approvals card (not raw ISO + "fullDay").
            var culture = ApprovalRequestText.ResolveCulture(Request.Headers.AcceptLanguage.ToString());
            var (title, description) = ApprovalRequestText.Build(
                input.UserDisplayName,
                input.StartDate,
                input.StartHalf,
                input.EndDate,
                input.EndHalf,
                input.CommentToApprover,
                input.Comment,
                input.RequestId,
                culture);

            var approvalItemId = await _graphApprovalService.CreateApprovalAsync(title, description, input.ApproverId, HttpContext.RequestAborted);

            output = approvalItemId is null ? null : new StartApprovalResponseDto
            {
                RequestId = input.RequestId,
                ApprovalReferenceId = approvalItemId,
                FlowRunId = "graph",
                Status = "pendingApproval"
            };
        }
        else if (_approvalFlowService.IsConfigured)
        {
            output = await _approvalFlowService.StartApprovalAsync(input, HttpContext.RequestAborted);
        }
        else
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { code = "approvalFlowNotConfigured" });
        }

        if (output is null)
        {
            request.Status = "failed";
            try
            {
                await _repository.SaveVacationRequestAsync(request);
            }
            catch (Exception saveEx)
            {
                _logger.LogError(saveEx, "Could not mark vacation request {RequestId} as failed after approval start failure.", id);
            }

            return StatusCode(StatusCodes.Status502BadGateway, new { code = "approvalFlowStartFailed" });
        }

        request.Status = output.Status;
        request.ApprovalReferenceId = output.ApprovalReferenceId;
        request.FlowRunId = output.FlowRunId;
        request.ApproverId = input.ApproverId;
        request.ApprovalProvider = "microsoftApprovals";
        request.UserDisplayName = input.UserDisplayName;
        request.CommentToApprover = input.CommentToApprover;

        try
        {
            // EO-414: optional tentative calendar entry while the approval is pending.
            await _outlookSyncService.ApplyLifecycleAsync(request, HttpContext.RequestAborted);
            await _repository.SaveVacationRequestAsync(request);
        }
        catch (Exception ex)
        {
            // Graph approval may already exist — keep the reference and report a clear code.
            _logger.LogError(ex, "Approval created but post-start persistence failed for {RequestId}.", id);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                code = "approvalPersistFailed",
                message = "The Microsoft approval was created but could not be saved in RPP.",
                approvalReferenceId = output.ApprovalReferenceId
            });
        }

        return Ok(output);
    }

    // EO-416: public + school holidays served from the database (maintained via
    // the Team Admin Open Data refresh actions).
    [HttpGet("holidays")]
    public async Task<ActionResult<PlanningResponse<PublicHoliday>>> GetPublicHolidays()
    {
        _logger.LogInformation("GET /api/planning/holidays");
        return Ok(await _repository.GetPublicHolidaysAsync());
    }

    [HttpGet("teamadmin/holidays")]
    public async Task<ActionResult<PlanningResponse<PublicHoliday>>> GetTeamAdminHolidays()
    {
        return Ok(await _repository.GetPublicHolidaysAsync());
    }

    [HttpPatch("teamadmin/holidays")]
    public async Task<ActionResult<PlanningResponse<PublicHoliday>>> ReplaceHolidays([FromBody] HolidayReplaceRequestDto request)
    {
        // EO-418: the holiday calendar is tenant-global but maintained from the Team
        // Admin Center — require ownership of the active team.
        var currentUserId = GetCurrentUserObjectId();

        if (!string.IsNullOrWhiteSpace(currentUserId)
            && !await IsCurrentUserM365OwnerAsync(currentUserId, ResolveRequestedTeamId()))
        {
            _logger.LogWarning("Holiday calendar write denied: caller {UserId} is not a team owner.", currentUserId);
            return Forbid();
        }

        _logger.LogInformation("PATCH /api/planning/teamadmin/holidays ({Count} entries)", request.Items.Count);
        return Ok(await _repository.ReplacePublicHolidaysAsync(request.Items));
    }

    // EO-454: Holiday calendar slot configuration (labels, tones, sources)
    [HttpGet("teamadmin/holiday-slots")]
    public async Task<ActionResult<PlanningResponse<HolidayCalendarSlot>>> GetHolidayCalendarSlots()
    {
        var (requestedTeamId, _) = ResolveTeamContext();

        if (string.IsNullOrWhiteSpace(requestedTeamId))
        {
            _logger.LogWarning("GET /api/planning/teamadmin/holiday-slots: no active team");
            return BadRequest("No active team");
        }

        _logger.LogInformation("GET /api/planning/teamadmin/holiday-slots for team {TeamId}", requestedTeamId);
        var slots = await _repository.GetHolidayCalendarSlotsAsync(requestedTeamId);
        return Ok(new PlanningResponse<HolidayCalendarSlot> { Items = slots.ToList() });
    }

    [HttpPatch("teamadmin/holiday-slots")]
    public async Task<ActionResult<PlanningResponse<HolidayCalendarSlot>>> UpdateHolidayCalendarSlots([FromBody] IReadOnlyCollection<HolidayCalendarSlot> slots)
    {
        // EO-454: Holiday slot configuration is team-scoped; require team ownership.
        var currentUserId = GetCurrentUserObjectId();

        if (!string.IsNullOrWhiteSpace(currentUserId)
            && !await IsCurrentUserM365OwnerAsync(currentUserId, ResolveRequestedTeamId()))
        {
            _logger.LogWarning("Holiday slots write denied: caller {UserId} is not a team owner.", currentUserId);
            return Forbid();
        }

        var (requestedTeamId, _) = ResolveTeamContext();

        if (string.IsNullOrWhiteSpace(requestedTeamId))
        {
            _logger.LogWarning("PATCH /api/planning/teamadmin/holiday-slots: no active team");
            return BadRequest("No active team");
        }

        _logger.LogInformation("PATCH /api/planning/teamadmin/holiday-slots for team {TeamId} ({Count} slots)", requestedTeamId, slots.Count);
        var updated = await _repository.UpdateHolidayCalendarSlotsAsync(requestedTeamId, slots);
        return Ok(new PlanningResponse<HolidayCalendarSlot> { Items = updated.ToList() });
    }


    // EO-421: profile photo proxy for the timeline avatars. Any authenticated
    // member may see colleague photos (they are visible in Teams anyway).
    [HttpGet("photos/{userId}")]
    public async Task<IActionResult> GetUserPhoto(string userId, CancellationToken cancellationToken)
    {
        var photo = await _userPhotoService.GetUserPhotoAsync(userId, cancellationToken);

        if (photo is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=86400";
        return File(photo.Value.Bytes, photo.Value.ContentType);
    }

    // === EO-421: tenant-wide display settings (Team Admin Center) ===

    [HttpGet("teamadmin/displayconfig")]
    public async Task<ActionResult<DisplayConfigDto>> GetDisplayConfig()
    {
        return Ok(await _repository.GetDisplayConfigAsync());
    }

    [HttpPatch("teamadmin/displayconfig")]
    public async Task<ActionResult<DisplayConfigDto>> SaveDisplayConfig([FromBody] DisplayConfigPatchDto patch)
    {
        // Like the holiday calendar: tenant-global but maintained from the Team
        // Admin Center — require ownership of the active team.
        var currentUserId = GetCurrentUserObjectId();

        if (!string.IsNullOrWhiteSpace(currentUserId)
            && !await IsCurrentUserM365OwnerAsync(currentUserId, ResolveRequestedTeamId()))
        {
            _logger.LogWarning("Display config write denied: caller {UserId} is not a team owner.", currentUserId);
            return Forbid();
        }

        _logger.LogInformation("PATCH /api/planning/teamadmin/displayconfig (showVacationSummary={ShowVacationSummary})",
            patch.ShowVacationSummary);
        return Ok(await _repository.SaveDisplayConfigAsync(patch));
    }

    // Team Memberships - REAL data from Microsoft Graph (EO-406 completed)
    // Uses GraphTeamMembershipService with ITokenAcquisition + proper Application permissions.
    [HttpGet("memberships")]
    public async Task<ActionResult<PlanningResponse<TeamMembershipDto>>> GetTeamMemberships(
        [FromQuery] string? pageToken = null,
        [FromQuery] string? teamId = null)
    {
        var (requestedTeamId, teamContextOrigin) = ResolveTeamContext(teamId);
        _logger.LogInformation(
            "GET /api/planning/memberships - pageToken={PageToken}, teamId={TeamId}, teamContextOrigin={Origin}",
            pageToken, requestedTeamId, teamContextOrigin);

        // EO-428: without a team this would previously have queried memberships unscoped. The
        // configured fallback hid that — removing it exposes the gap, so it is closed here.
        if (string.IsNullOrWhiteSpace(requestedTeamId))
        {
            _logger.LogWarning("Membership read has no team context (origin={Origin}).", teamContextOrigin);
            return NoTeamContext();
        }

        try
        {
            var currentUserId = GetCurrentUserObjectId();

            if (!string.IsNullOrWhiteSpace(currentUserId))
            {
                // EO-420: gate on real M365 team membership (Graph), not on planning
                // assignments — a freshly connected host team has no assignments yet.
                // EO-428: strict — a membership gate that cannot reach Graph must not decide.
                // Denying on an outage reads as "you have no access", allowing reads as "verified".
                var graphMembers = await _graphService.GetRealTeamMembersAsync(requestedTeamId, throwOnFailure: true);
                var isMember = graphMembers.Any(membership =>
                    string.Equals(membership.Member.Id, currentUserId, StringComparison.OrdinalIgnoreCase));

                if (!isMember)
                {
                    _logger.LogWarning("Team membership read denied for team {TeamId}: user {UserId} is not a member of the M365 team.", requestedTeamId, currentUserId);
                    return Forbid();
                }
            }

            // EO-415: the repository resolves organisation/location via the configured mappings.
            var result = await _repository.GetTeamMembershipsAsync(pageToken, requestedTeamId);
            return Ok(result);
        }
        catch (GraphUnavailableException ex)
        {
            // EO-428: this used to answer HTTP 200 with an empty list. The client then had no way
            // to tell an outage from a team with nobody in it, and showed "no plannable people
            // found" — pointing the user at missing data while the cause was infrastructure. No
            // amount of client-side handling could reach it, because the response said success.
            _logger.LogError(ex, "Membership read failed because Microsoft Graph did not answer for team {TeamId}.", requestedTeamId);
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                code = "membershipLookupFailed",
                message = "Team memberships could not be read from Microsoft Graph."
            });
        }
    }

    // === EO-415: configurable organisations, locations and profile value mappings ===

    [HttpGet("teamadmin/orgconfig")]
    public async Task<ActionResult<OrgConfigDto>> GetOrgConfig()
    {
        _logger.LogInformation("GET /api/planning/teamadmin/orgconfig");
        return Ok(await _repository.GetOrgConfigAsync());
    }

    [HttpPatch("teamadmin/orgconfig")]
    public async Task<ActionResult<OrgConfigDto>> SaveOrgConfig([FromBody] OrgConfigPatchDto patch)
    {
        _logger.LogInformation("PATCH /api/planning/teamadmin/orgconfig ({OrgCount} organisations, {LocationCount} locations, {MappingCount} mappings)",
            patch.Organisations.Count, patch.Locations.Count, patch.Mappings.Count);

        try
        {
            return Ok(await _repository.SaveOrgConfigAsync(patch));
        }
        catch (InvalidOperationException validationError)
        {
            return Conflict(new { code = validationError.Message });
        }
    }

    // === EO-408: Team Admin Center Endpoints - Persistent SQL Backend ===
    [HttpGet("teamadmin/teams")]
    public async Task<ActionResult<PlanningResponse<TeamAdminTeamSummaryDto>>> GetManagedTeams()
    {
        var (requestedTeamId, teamContextOrigin) = ResolveTeamContext();
        _logger.LogInformation(
            "GET /api/planning/teamadmin/teams - teamId={TeamId}, teamContextOrigin={Origin}",
            requestedTeamId, teamContextOrigin);
        var currentUserId = GetCurrentUserObjectId();

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            // Local development with auth bypass can run without Entra claims.
            return Ok(await _repository.GetManagedTeamsAsync(requestedTeamId));
        }

        // EO-428: an empty list here used to mean two different things — "you own no teams" and
        // "nobody told us which team you are in". The second is now said out loud, because the
        // remedy is choosing a team, not asking an administrator for rights.
        if (string.IsNullOrWhiteSpace(requestedTeamId))
        {
            _logger.LogWarning("Managed teams read has no team context (origin={Origin}).", teamContextOrigin);
            return NoTeamContext();
        }

        // EO-419: Team Admin data exists only inside a host-team context (owner-gated).
        if (!await IsCurrentUserM365OwnerAsync(currentUserId, requestedTeamId))
        {
            return Ok(new PlanningResponse<TeamAdminTeamSummaryDto> { Items = new List<TeamAdminTeamSummaryDto>(), TotalCount = 0 });
        }

        return Ok(await _repository.GetManagedTeamsAsync(requestedTeamId));
    }

    [HttpPost("teamadmin/teams")]
    public async Task<ActionResult<TeamAdminTeamSummaryDto>> CreateTeam([FromBody] TeamCreateRequestDto request)
    {
        _logger.LogInformation("POST /api/planning/teamadmin/teams ({TeamName})", request.TeamName);

        try
        {
            var currentUserId = GetCurrentUserObjectId();

            if (string.IsNullOrWhiteSpace(currentUserId))
            {
                _logger.LogWarning("Create team denied: no user object id claim present.");
                return Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.SourceTeamId))
            {
                return BadRequest(new { code = "sourceTeamIdRequired" });
            }

            var isOwner = await _graphService.IsUserOwnerOfTeamAsync(currentUserId, request.SourceTeamId);

            if (!isOwner)
            {
                _logger.LogWarning("Create team denied: user {UserId} is not an M365 Team owner for source team {TeamId}.", currentUserId, request.SourceTeamId);
                return Forbid();
            }

            var createdTeam = await _repository.CreateTeamAsync(request);
            return Ok(createdTeam);
        }
        catch (InvalidOperationException validationError)
        {
            return Conflict(new { code = validationError.Message });
        }
    }

    [HttpPatch("teamadmin/teams")]
    public async Task<ActionResult<PlanningResponse<TeamAdminTeamSummaryDto>>> UpdateTeams([FromBody] TeamsUpdateRequestDto request)
    {
        _logger.LogInformation("PATCH /api/planning/teamadmin/teams ({Count} rows)", request.Teams.Count);

        try
        {
            foreach (var teamRow in request.Teams)
            {
                var access = await EnsureTeamAccessAsync(teamRow.TeamId);
                if (access.NotFound)
                {
                    return NotFound();
                }

                if (!access.Allowed)
                {
                    return Forbid();
                }
            }

            var result = await _repository.UpdateTeamsAsync(request, ResolveRequestedTeamId());
            return Ok(result);
        }
        catch (InvalidOperationException validationError)
        {
            return Conflict(new { code = validationError.Message });
        }
    }

    [HttpDelete("teamadmin/teams/{teamId}")]
    public async Task<IActionResult> DeleteTeam(string teamId)
    {
        _logger.LogInformation("DELETE /api/planning/teamadmin/teams/{TeamId}", teamId);

        try
        {
            var access = await EnsureTeamAccessAsync(teamId);
            if (access.NotFound)
            {
                return NotFound();
            }

            if (!access.Allowed)
            {
                return Forbid();
            }

            await _repository.DeleteTeamAsync(teamId, ResolveRequestedTeamId());
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (InvalidOperationException validationError)
        {
            return Conflict(new { code = validationError.Message });
        }
    }

    [HttpGet("teamadmin/details/{teamId}")]
    public async Task<ActionResult<TeamAdminDetailsDto>> GetTeamAdminDetails(string teamId)
    {
        _logger.LogInformation("GET /api/planning/teamadmin/details/{TeamId}", teamId);

        try
        {
            var access = await EnsureTeamAccessAsync(teamId);
            if (access.NotFound)
            {
                return NotFound();
            }

            if (!access.Allowed)
            {
                return Forbid();
            }

            var details = await _repository.GetTeamAdminDetailsAsync(teamId, ResolveRequestedTeamId());
            return Ok(details);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPatch("teamadmin/details")]
    public async Task<ActionResult<TeamAdminDetailsDto>> PatchTeamAdmin([FromBody] TeamAdminSaveRequestDto patch)
    {
        _logger.LogInformation("PATCH /api/planning/teamadmin/details for team {TeamId}", patch.TeamId);

        try
        {
            var access = await EnsureTeamAccessAsync(patch.TeamId);
            if (access.NotFound)
            {
                return NotFound();
            }

            if (!access.Allowed)
            {
                return Forbid();
            }

            var updated = await _repository.SaveTeamAdminChangesAsync(patch, ResolveRequestedTeamId());
            return Ok(updated);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    /// <summary>
    /// Hard-remove one person from RPP planning (all host-scoped assignments). Prefer this over an
    /// empty primaryTeamId patch when cleaning Entra-deleted orphans that only show as a GUID.
    /// </summary>
    [HttpDelete("teamadmin/members/{userId}")]
    public async Task<ActionResult<object>> RemoveTeamAdminMember(string userId)
    {
        _logger.LogInformation("DELETE /api/planning/teamadmin/members/{UserId}", userId);

        if (string.IsNullOrWhiteSpace(userId))
        {
            return BadRequest(new { code = "userIdRequired", message = "userId is required." });
        }

        // Authorize against the active host context (same gate as team admin details).
        var access = await EnsureTeamAccessAsync(AllTeamsId);
        if (access.NotFound)
        {
            return NotFound(new { code = "teamNotFound", message = "No managed team context was found for this host." });
        }

        if (!access.Allowed)
        {
            return Forbid();
        }

        try
        {
            var removed = await _repository.RemoveMemberFromHostAsync(userId, ResolveRequestedTeamId());
            _logger.LogInformation(
                "DELETE teamadmin/members removed {Count} assignment row(s) for {UserId}",
                removed,
                userId);
            return Ok(new { userId, removedAssignments = removed });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "DELETE teamadmin/members failed for {UserId}", userId);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                code = "memberRemoveFailed",
                message = "The member could not be removed from RPP planning."
            });
        }
    }

    private async Task<(bool Allowed, bool NotFound)> EnsureTeamAccessAsync(string teamId)
    {
        if (string.IsNullOrWhiteSpace(teamId))
        {
            return (true, false);
        }

        var currentUserId = GetCurrentUserObjectId();

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            _logger.LogWarning("Team Admin access denied for team {TeamId}: no user object id claim present.", teamId);
            return (false, false);
        }

        try
        {
            // EO-419: existence is checked within the host scope — foreign teams are 404.
            _ = await _repository.GetTeamAdminDetailsAsync(teamId, ResolveRequestedTeamId());
        }
        catch (KeyNotFoundException)
        {
            return (false, true);
        }

        if (string.Equals(teamId, AllTeamsId, StringComparison.OrdinalIgnoreCase))
        {
            var requestedTeamId = ResolveRequestedTeamId();

            if (!await IsCurrentUserM365OwnerAsync(currentUserId, requestedTeamId))
            {
                _logger.LogWarning("Team Admin access denied for all teams: user {UserId} does not own any managed teams.", currentUserId);
                return (false, false);
            }

            return (true, false);
        }

        var scopedTeamId = ResolveRequestedTeamId();

        if (!await IsCurrentUserM365OwnerAsync(currentUserId, scopedTeamId))
        {
            _logger.LogWarning("Team Admin access denied for team {TeamId}: user {UserId} is not an M365 Team owner.", teamId, currentUserId);
            return (false, false);
        }

        return (true, false);
    }

    // === EO-418: caller access summary (tab gating + admin guards) ===

    /// <summary>
    /// EO-428 FR-428.2: the Microsoft 365 teams the caller belongs to, for the personal app scope
    /// where no host context says which team to show. The primary team is flagged so the client can
    /// preselect it — the Product Owner decision is "primary team as the default, switchable".
    ///
    /// This endpoint deliberately takes no team context: it is what you call precisely when you do
    /// not have one.
    /// </summary>
    [HttpGet("my-teams")]
    public async Task<ActionResult<PlanningResponse<UserTeamDto>>> GetMyTeams()
    {
        var currentUserId = GetCurrentUserObjectId();

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            _logger.LogWarning("GET /api/planning/my-teams denied: no user object id claim present.");
            return Forbid();
        }

        try
        {
            var teams = await _graphService.GetTeamsForUserAsync(currentUserId);
            var primaryTeamId = await ResolvePrimaryTeamIdAsync(currentUserId, teams);

            foreach (var team in teams)
            {
                team.IsPrimary = string.Equals(team.TeamId, primaryTeamId, StringComparison.OrdinalIgnoreCase);
            }

            _logger.LogInformation(
                "GET /api/planning/my-teams - user={UserId}, teams={Count}, primary={PrimaryTeamId}",
                currentUserId, teams.Count, primaryTeamId ?? "-");

            return Ok(new PlanningResponse<UserTeamDto> { Items = teams, TotalCount = teams.Count });
        }
        catch (Exception ex)
        {
            // "We could not ask Graph" must not arrive as "you are in no teams" — that would send
            // the user hunting for a missing membership instead of retrying.
            _logger.LogError(ex, "Failed to resolve the teams of user {UserId}.", currentUserId);
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                code = "teamLookupFailed",
                message = "The teams of the signed-in user could not be resolved."
            });
        }
    }

    /// <summary>
    /// The caller's primary team, taken from the planning assignments and matched against the teams
    /// Graph reports. Returns null when the assignments name no primary team the caller is actually
    /// in — the client then asks rather than picking one, per the FR-428.2 decision.
    /// </summary>
    private async Task<string?> ResolvePrimaryTeamIdAsync(string currentUserId, IReadOnlyCollection<UserTeamDto> teams)
    {
        if (teams.Count == 0)
        {
            return null;
        }

        if (teams.Count == 1)
        {
            return teams.First().TeamId;
        }

        try
        {
            var memberships = await _repository.GetTeamMembershipsAsync();
            var primary = memberships.Items.FirstOrDefault(membership =>
                membership.IsPrimary
                && string.Equals(membership.Member.Id, currentUserId, StringComparison.OrdinalIgnoreCase)
                && teams.Any(team => string.Equals(team.TeamId, membership.TeamId, StringComparison.OrdinalIgnoreCase)));

            return primary?.TeamId;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not resolve the primary team of user {UserId}; the client will ask.", currentUserId);
            return null;
        }
    }

    /// <summary>
    /// Role/ownership summary for the caller in the active team context.
    /// isTeamOwner: owner of the active M365 Team (Graph). isAppAdmin: Entra directory
    /// role per AppAdmin:AllowedRoleTemplateIds, validated via the token's wids claim.
    /// </summary>
    [HttpGet("access")]
    public async Task<ActionResult<AccessInfoDto>> GetAccess()
    {
        var currentUserId = GetCurrentUserObjectId();

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            // Local development with auth bypass: everything is accessible.
            return Ok(new AccessInfoDto { IsTeamOwner = true, IsAppAdmin = true });
        }

        var (requestedTeamId, teamContextOrigin) = ResolveTeamContext();

        // EO-428 FR-428.4: guests are never team administrators. Microsoft 365 already prevents a
        // guest from owning a team, so this changes no outcome today — it states the rule where it
        // can be read and tested, instead of leaving it to be rediscovered from Graph behaviour.
        var isGuest = await IsCurrentUserGuestAsync(currentUserId, requestedTeamId);
        var isTeamOwner = !isGuest
            && !string.IsNullOrWhiteSpace(requestedTeamId)
            && await IsCurrentUserM365OwnerAsync(currentUserId, requestedTeamId);
        var isAppAdmin = HasAppAdminRole();
        var teamDisplayName = await _graphService.GetTeamDisplayNameAsync(requestedTeamId);

        // Diagnostics: whether the SSO token carries directory roles at all (wids).
        var widsValues = User.Claims
            .Where(claim => string.Equals(claim.Type, "wids", StringComparison.OrdinalIgnoreCase))
            .Select(claim => claim.Value)
            .ToList();
        _logger.LogInformation(
            "Access check for user {UserId}: teamId={TeamId} ({TeamName}, origin={Origin}), isTeamOwner={IsTeamOwner}, isAppAdmin={IsAppAdmin}, isGuest={IsGuest}, widsCount={WidsCount}, wids=[{Wids}]",
            currentUserId, requestedTeamId ?? "-", teamDisplayName ?? "-", teamContextOrigin, isTeamOwner, isAppAdmin, isGuest, widsValues.Count, string.Join(",", widsValues));

        return Ok(new AccessInfoDto
        {
            IsTeamOwner = isTeamOwner,
            IsAppAdmin = isAppAdmin,
            TeamDisplayName = teamDisplayName,
            IsGuest = isGuest
        });
    }

    /// <summary>
    /// EO-428: whether the caller is a B2B guest of the active team. Graph flags this via
    /// <c>userType</c>, which <see cref="TeamMembershipDto.IsGuest"/> already carries.
    /// </summary>
    private async Task<bool> IsCurrentUserGuestAsync(string currentUserId, string? teamId)
    {
        if (string.IsNullOrWhiteSpace(teamId))
        {
            return false;
        }

        var members = await _graphService.GetRealTeamMembersAsync(teamId);

        return members.Any(member =>
            string.Equals(member.Member.Id, currentUserId, StringComparison.OrdinalIgnoreCase)
            && member.Member.IsGuest);
    }

    /// <summary>
    /// EO-418: per-tenant reset of the holiday calendar so individual calendars can be
    /// loaded fresh. App-admin only (directory role).
    /// </summary>
    [HttpPost("appadmin/holidays/clear")]
    public async Task<ActionResult<PlanningResponse<PublicHoliday>>> ClearHolidays()
    {
        if (!IsAppAdminOrDevBypass())
        {
            _logger.LogWarning("Holiday calendar clear denied: caller lacks an app-admin directory role.");
            return Forbid();
        }

        _logger.LogInformation("POST /api/planning/appadmin/holidays/clear");
        return Ok(await _repository.ReplacePublicHolidaysAsync(Array.Empty<PublicHoliday>()));
    }

    private bool IsAppAdminOrDevBypass()
    {
        return string.IsNullOrWhiteSpace(GetCurrentUserObjectId()) || HasAppAdminRole();
    }

    // EO-424: the rule itself lives in AppAdminAuthorization so every admin route shares one
    // implementation instead of drifting copies.
    private bool HasAppAdminRole() => AppAdminAuthorization.HasAppAdminRole(User, _appAdminSettings);

    /// <summary>
    /// EO-459 FR-459.1: team-scoped read gate shared by absences, vacation balances, and events.
    /// Mirrors memberships: team context required, Graph members loaded strictly, caller must be a member.
    /// </summary>
    private async Task<(TeamMemberReadContext? Context, ActionResult? Error)> EnsureTeamMemberReadAsync(string? queryTeamId = null)
    {
        var (requestedTeamId, origin) = ResolveTeamContext(queryTeamId);

        if (string.IsNullOrWhiteSpace(requestedTeamId))
        {
            _logger.LogWarning("Team-scoped planning read has no team context (origin={Origin}).", origin);
            return (null, NoTeamContext());
        }

        var currentUserId = GetCurrentUserObjectId();

        try
        {
            var graphMembers = await _graphService.GetRealTeamMembersAsync(requestedTeamId, throwOnFailure: true);
            var allowedUserIds = new HashSet<string>(
                graphMembers
                    .Select(membership => membership.Member.Id)
                    .Where(id => !string.IsNullOrWhiteSpace(id)),
                StringComparer.OrdinalIgnoreCase);

            // Local auth bypass (no oid): do not invent a membership check.
            if (!string.IsNullOrWhiteSpace(currentUserId) && !allowedUserIds.Contains(currentUserId))
            {
                _logger.LogWarning(
                    "Team-scoped planning read denied for team {TeamId}: user {UserId} is not a member.",
                    requestedTeamId,
                    currentUserId);
                return (null, StatusCode(StatusCodes.Status403Forbidden, new
                {
                    code = "forbidden",
                    message = "Not a member of the active team."
                }));
            }

            return (new TeamMemberReadContext(requestedTeamId, allowedUserIds), null);
        }
        catch (GraphUnavailableException ex)
        {
            _logger.LogError(ex, "Team-scoped planning read failed because Microsoft Graph did not answer for team {TeamId}.", requestedTeamId);
            return (null, StatusCode(StatusCodes.Status502BadGateway, new
            {
                code = "membershipLookupFailed",
                message = "Team memberships could not be read from Microsoft Graph."
            }));
        }
    }

    private static PlanningResponse<T> FilterPlanningPage<T>(
        PlanningResponse<T> source,
        Func<T, string?> userIdSelector,
        IReadOnlySet<string> allowedUserIds)
    {
        var filtered = source.Items
            .Where(item =>
            {
                var userId = userIdSelector(item);
                return !string.IsNullOrWhiteSpace(userId) && allowedUserIds.Contains(userId);
            })
            .ToList();

        return new PlanningResponse<T>
        {
            Items = filtered,
            TotalCount = filtered.Count,
            NextPageToken = source.NextPageToken
        };
    }

    /// <summary>
    /// EO-418/419 + EO-459: person-scoped writes — self or owner of the active M365 team,
    /// with team membership constraints when a team context is present.
    /// </summary>
    private async Task<ActionResult?> EvaluateWriteAccessAsync(string targetUserId, string operationLabel)
    {
        var currentUserId = GetCurrentUserObjectId();

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return null; // local development with auth bypass
        }

        var (teamId, origin) = ResolveTeamContext();
        var isSelf = string.Equals(currentUserId, targetUserId, StringComparison.OrdinalIgnoreCase);

        if (isSelf)
        {
            if (string.IsNullOrWhiteSpace(teamId))
            {
                // Personal scope: own rows without a host team are still allowed.
                return null;
            }

            if (!await IsUserMemberOfTeamAsync(currentUserId, teamId))
            {
                _logger.LogWarning(
                    "{Operation} denied for self {UserId}: not a member of team {TeamId} (origin={Origin}).",
                    operationLabel,
                    currentUserId,
                    teamId,
                    origin);
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    code = "forbidden",
                    message = $"{operationLabel} denied: caller is not a member of the active team."
                });
            }

            return null;
        }

        // Owner path requires an explicit team — never guess (EO-428).
        if (string.IsNullOrWhiteSpace(teamId))
        {
            _logger.LogWarning(
                "{Operation} denied for {TargetUserId}: no team context for owner write (origin={Origin}).",
                operationLabel,
                targetUserId,
                origin);
            return NoTeamContext();
        }

        if (!await IsCurrentUserM365OwnerAsync(currentUserId, teamId))
        {
            _logger.LogWarning(
                "{Operation} denied for {TargetUserId}: caller {UserId} is not owner of team {TeamId}.",
                operationLabel,
                targetUserId,
                currentUserId,
                teamId);
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                code = "forbidden",
                message = $"{operationLabel} denied: caller is neither the person nor a team owner."
            });
        }

        if (!await IsUserMemberOfTeamAsync(targetUserId, teamId))
        {
            _logger.LogWarning(
                "{Operation} denied for {TargetUserId}: target is not a member of team {TeamId}.",
                operationLabel,
                targetUserId,
                teamId);
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                code = "forbidden",
                message = $"{operationLabel} denied: target user is not a member of the active team."
            });
        }

        return null;
    }

    /// <summary>
    /// EO-418/419: person-scoped writes are allowed for the person themselves or for
    /// an owner of the active M365 Team (with EO-459 membership constraints).
    /// Prefer <see cref="EvaluateWriteAccessAsync"/> at HTTP boundaries so noTeamContext is distinct from 403.
    /// </summary>
    private async Task<bool> CanWriteForUserAsync(string targetUserId)
    {
        return await EvaluateWriteAccessAsync(targetUserId, "Write") is null;
    }

    private Task<bool> IsCurrentUserM365OwnerAsync(string currentUserId, string? requestedTeamId = null)
    {
        // Team Admin entities use internal planning team IDs; owner verification must
        // use the host-team context configured for Graph instead of those internal IDs.
        return _graphService.IsUserOwnerOfTeamAsync(currentUserId, requestedTeamId);
    }

    private async Task<bool> IsUserMemberOfTeamAsync(string userId, string teamId)
    {
        try
        {
            var members = await _graphService.GetRealTeamMembersAsync(teamId, throwOnFailure: true);
            return members.Any(membership =>
                string.Equals(membership.Member.Id, userId, StringComparison.OrdinalIgnoreCase));
        }
        catch (GraphUnavailableException)
        {
            // Fail closed: cannot prove membership.
            return false;
        }
    }

    private sealed record TeamMemberReadContext(string TeamId, HashSet<string> AllowedUserIds);

    /// <summary>
    /// EO-428: where the active team came from. Logged with every resolution so field diagnosis does
    /// not depend on inferring which branch ran.
    /// </summary>
    private enum TeamContextOrigin
    {
        Query,
        Header,
        Unresolved
    }

    private string? ResolveRequestedTeamId(string? queryTeamId = null)
    {
        return ResolveTeamContext(queryTeamId).TeamId;
    }

    /// <summary>
    /// Resolves the active team from the explicit query parameter, then the host context header.
    ///
    /// EO-428: there is deliberately no third step. This used to fall back to the configured
    /// <c>Graph:TeamGroupId</c>, which meant every request without host context — the whole personal
    /// app scope — silently claimed to be one specific team. A caller who was not a member of that
    /// team then received a permission error for a team they never asked about. "Which team do you
    /// mean" is now answered with "unresolved" rather than with a guess.
    /// </summary>
    private (string? TeamId, TeamContextOrigin Origin) ResolveTeamContext(string? queryTeamId = null)
    {
        if (!string.IsNullOrWhiteSpace(queryTeamId))
        {
            return (queryTeamId, TeamContextOrigin.Query);
        }

        if (Request.Headers.TryGetValue("X-RPP-Active-TeamId", out var headerValues))
        {
            var headerTeamId = headerValues.FirstOrDefault();

            if (!string.IsNullOrWhiteSpace(headerTeamId))
            {
                return (headerTeamId, TeamContextOrigin.Header);
            }
        }

        return (null, TeamContextOrigin.Unresolved);
    }

    /// <summary>
    /// EO-428 FR-428.3: the response for "no team context could be resolved". HTTP 428 Precondition
    /// Required carries the meaning — the request needs a team before it can be answered — and the
    /// body repeats it as a machine-readable code so the distinction survives a proxy that rewrites
    /// an unusual status. This must never be 403: that sends a user to their administrator over a
    /// missing selection.
    /// </summary>
    private ObjectResult NoTeamContext()
    {
        return StatusCode(StatusCodes.Status428PreconditionRequired, new
        {
            code = "noTeamContext",
            message = "No team context could be resolved for this request."
        });
    }

    private string? GetCurrentUserObjectId()
    {
        return User.FindFirstValue("oid")
            ?? User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
    }

}
