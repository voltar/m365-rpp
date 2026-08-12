using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using RppWebApi.Models;
using RppWebApi.Services;

namespace RppWebApi.Controllers;

/// <summary>
/// EO-424: Admin API for inbound Outlook mailbox sync.
/// Provides manual trigger and status/log endpoints.
/// EO-425: Adds GET/PATCH settings endpoint for editing the shared mailbox address.
/// Access is restricted to App Admin (Entra directory role check).
/// </summary>
[ApiController]
[Route("api/admin/mailbox-sync")]
[Authorize]
public class MailboxSyncController : ControllerBase
{
    private readonly MailboxSyncService _syncService;
    private readonly MailboxSyncState _state;
    private readonly IPlanningRepository _repository;
    private readonly AppAdminSettings _appAdminSettings;
    private readonly ILogger<MailboxSyncController> _logger;

    public MailboxSyncController(
        MailboxSyncService syncService,
        MailboxSyncState state,
        IPlanningRepository repository,
        IOptions<AppAdminSettings> appAdminSettings,
        ILogger<MailboxSyncController> logger)
    {
        _syncService = syncService;
        _state = state;
        _repository = repository;
        _appAdminSettings = appAdminSettings.Value;
        _logger = logger;
    }

    /// <summary>
    /// EO-424: every route here is tenant-wide administration - it reads absence data of other
    /// people and can trigger Graph calls against the shared mailbox. [Authorize] alone only
    /// proves the caller is signed in, which is not the documented rule.
    /// </summary>
    private bool IsAppAdmin() =>
        AppAdminAuthorization.IsAppAdminOrDevBypass(User, _appAdminSettings);

    /// <summary>
    /// GET /api/admin/mailbox-sync/status — current sync state and last result.
    /// </summary>
    [HttpGet("status")]
    public ActionResult<MailboxSyncStatusResponse> GetStatus()
    {
        if (!IsAppAdmin())
        {
            _logger.LogWarning("Mailbox sync status denied: caller lacks an app-admin directory role.");
            return Forbid();
        }

        return Ok(BuildStatus());
    }

    private MailboxSyncStatusResponse BuildStatus()
    {
        var lastResult = _syncService.LastSyncResult;

        return new MailboxSyncStatusResponse
        {
            Enabled = _syncService.IsEnabled,
            IsRunning = _syncService.IsRunning,
            LastSyncStartedAt = lastResult?.StartedAt,
            LastSyncCompletedAt = lastResult?.CompletedAt,
            MessagesProcessed = lastResult?.MessagesProcessed ?? 0,
            AbsencesCreated = lastResult?.AbsencesCreated ?? 0,
            AbsencesUpdated = lastResult?.AbsencesUpdated ?? 0,
            AbsencesDeleted = lastResult?.AbsencesDeleted ?? 0,
            Errors = lastResult?.Errors ?? 0,
            Skipped = lastResult?.Skipped ?? 0,
            LastError = lastResult?.LastError,
            Entries = lastResult?.Entries.Select(e => new SyncEntryResponse
            {
                MessageId = e.MessageId,
                MessageSubject = e.MessageSubject,
                Action = e.Action,
                EmployeeId = e.EmployeeId,
                Detail = e.Detail
            }).ToList() ?? new List<SyncEntryResponse>()
        };
    }

    /// <summary>
    /// GET /api/admin/mailbox-sync/log?page=1 - completed cycles, newest first (FR-424.9).
    /// The history is in-memory and bounded, so it resets on restart; the durable record of
    /// what was imported is Absences.Source = "outlook-mailbox".
    /// </summary>
    [HttpGet("log")]
    public ActionResult<MailboxSyncLogResponse> GetLog([FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!IsAppAdmin())
        {
            _logger.LogWarning("Mailbox sync log denied: caller lacks an app-admin directory role.");
            return Forbid();
        }

        var effectivePage = page < 1 ? 1 : page;
        var effectivePageSize = pageSize is < 1 or > 50 ? 10 : pageSize;
        var cycles = _state.RecentCycles();

        var items = cycles
            .Skip((effectivePage - 1) * effectivePageSize)
            .Take(effectivePageSize)
            .Select(cycle => new MailboxSyncLogEntryResponse
            {
                StartedAt = cycle.StartedAt,
                CompletedAt = cycle.CompletedAt,
                MessagesProcessed = cycle.MessagesProcessed,
                AbsencesCreated = cycle.AbsencesCreated,
                AbsencesUpdated = cycle.AbsencesUpdated,
                AbsencesDeleted = cycle.AbsencesDeleted,
                Errors = cycle.Errors,
                Skipped = cycle.Skipped
            })
            .ToList();

        return Ok(new MailboxSyncLogResponse
        {
            Page = effectivePage,
            PageSize = effectivePageSize,
            TotalCount = cycles.Count,
            RetainedCycles = MailboxSyncState.MaxRetainedCycles,
            Items = items
        });
    }

    /// <summary>
    /// POST /api/admin/mailbox-sync/trigger — manually trigger a sync cycle.
    /// Returns 409 if a sync is already running.
    /// </summary>
    [HttpPost("trigger")]
    public async Task<ActionResult<MailboxSyncStatusResponse>> TriggerSync(CancellationToken cancellationToken)
    {
        if (!IsAppAdmin())
        {
            _logger.LogWarning("Manual mailbox sync denied: caller lacks an app-admin directory role.");
            return Forbid();
        }

        if (_syncService.IsRunning)
        {
            return Conflict(new { message = "A sync cycle is already in progress." });
        }

        _logger.LogInformation("Manual mailbox sync triggered by user.");
        await _syncService.RunSyncAsync(cancellationToken);

        return Ok(BuildStatus());
    }

    /// <summary>
    /// GET /api/admin/mailbox-sync/settings — returns the current mailbox address configuration.
    /// </summary>
    [HttpGet("settings")]
    public async Task<ActionResult<MailboxSyncConfigDto>> GetSettings()
    {
        if (!IsAppAdmin())
        {
            return Forbid();
        }

        var config = await _repository.GetMailboxSyncConfigAsync();
        return Ok(config);
    }

    /// <summary>
    /// PATCH /api/admin/mailbox-sync/settings — updates the shared mailbox address.
    /// Validates e-mail format before persisting.
    /// </summary>
    [HttpPatch("settings")]
    public async Task<ActionResult<MailboxSyncConfigDto>> PatchSettings([FromBody] MailboxSyncConfigPatchDto patch)
    {
        if (!IsAppAdmin())
        {
            _logger.LogWarning("Mailbox sync settings change denied: caller lacks an app-admin directory role.");
            return Forbid();
        }

        if (patch.MailboxAddress is not null)
        {
            var address = patch.MailboxAddress.Trim();

            if (address.Length > 0 && !IsValidEmail(address))
            {
                return BadRequest(new { message = "MailboxAddress must be a valid e-mail address." });
            }
        }

        _logger.LogInformation("Mailbox sync address updated by user.");
        var updated = await _repository.SaveMailboxSyncConfigAsync(patch);
        return Ok(updated);
    }

    /// <summary>
    /// Simple email pattern matching the frontend validation: local@domain.tld.
    /// Deliberately restrictive — shared mailbox addresses follow standard corporate format.
    /// </summary>
    private static readonly System.Text.RegularExpressions.Regex EmailPattern =
        new(@"^[^\s@]+@[^\s@]+\.[^\s@]+$", System.Text.RegularExpressions.RegexOptions.Compiled);

    private static bool IsValidEmail(string address) => EmailPattern.IsMatch(address);
}

// ── Response DTOs ──────────────────────────────────────────────────────

public class MailboxSyncStatusResponse
{
    public bool Enabled { get; set; }
    public bool IsRunning { get; set; }
    public DateTime? LastSyncStartedAt { get; set; }
    public DateTime? LastSyncCompletedAt { get; set; }
    public int MessagesProcessed { get; set; }
    public int AbsencesCreated { get; set; }
    public int AbsencesUpdated { get; set; }
    public int AbsencesDeleted { get; set; }
    public int Errors { get; set; }
    public int Skipped { get; set; }
    /// <summary>Reason the last cycle failed, if it did.</summary>
    public string? LastError { get; set; }
    public List<SyncEntryResponse> Entries { get; set; } = new();
}

public class MailboxSyncLogResponse
{
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    /// <summary>How many cycles the in-memory history keeps at most.</summary>
    public int RetainedCycles { get; set; }
    public List<MailboxSyncLogEntryResponse> Items { get; set; } = new();
}

public class MailboxSyncLogEntryResponse
{
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int MessagesProcessed { get; set; }
    public int AbsencesCreated { get; set; }
    public int AbsencesUpdated { get; set; }
    public int AbsencesDeleted { get; set; }
    public int Errors { get; set; }
    public int Skipped { get; set; }
}

public class SyncEntryResponse
{
    public string? MessageId { get; set; }
    public string? MessageSubject { get; set; }
    public string? Action { get; set; }
    public string? EmployeeId { get; set; }
    public string? Detail { get; set; }
}
