using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using RppWebApi.Models;
using RppWebApi.Services;

namespace RppWebApi.Controllers;

/// <summary>
/// EO-410: decision writeback endpoint for the Power Automate approval flow.
/// Anonymous route (the flow has no Entra user context) protected by a shared
/// secret header; the secret lives in user secrets / Azure app settings (EO-409).
/// </summary>
[ApiController]
[Route("api/approvals")]
public class ApprovalCallbackController : ControllerBase
{
    public const string SecretHeaderName = "X-RPP-Approval-Secret";

    private readonly IPlanningRepository _repository;
    private readonly ApprovalFlowSettings _settings;
    private readonly OutlookCalendarSyncService _outlookSyncService;
    private readonly ILogger<ApprovalCallbackController> _logger;

    public ApprovalCallbackController(
        IPlanningRepository repository,
        IOptions<ApprovalFlowSettings> settings,
        OutlookCalendarSyncService outlookSyncService,
        ILogger<ApprovalCallbackController> logger)
    {
        _repository = repository;
        _settings = settings.Value;
        _outlookSyncService = outlookSyncService;
        _logger = logger;
    }

    [HttpPost("callback")]
    [AllowAnonymous]
    public async Task<IActionResult> ApplyDecision([FromBody] ApprovalCallbackDto callback)
    {
        if (!IsAuthorizedCallback())
        {
            _logger.LogWarning("Approval callback rejected: missing or invalid {Header} header.", SecretHeaderName);
            return Unauthorized();
        }

        if (string.IsNullOrWhiteSpace(callback.RequestId)
            || string.IsNullOrWhiteSpace(callback.ApprovalReferenceId)
            || string.IsNullOrWhiteSpace(callback.Decision))
        {
            return BadRequest(new { code = "callbackContractIncomplete" });
        }

        var updated = await _repository.ApplyApprovalDecisionAsync(callback);

        if (updated is null)
        {
            return NotFound(new { code = "pendingRequestNotFound" });
        }

        // EO-414: approved → upsert the calendar event; rejected → remove it.
        if (_outlookSyncService.IsEnabled)
        {
            await _outlookSyncService.ApplyLifecycleAsync(updated, HttpContext.RequestAborted);
            await _repository.SaveVacationRequestAsync(updated);
        }

        _logger.LogInformation(
            "Approval decision applied: request {RequestId} -> {Status}.",
            updated.Id, updated.Status);

        return Ok(new { requestId = updated.Id, status = updated.Status });
    }

    private bool IsAuthorizedCallback()
    {
        if (string.IsNullOrWhiteSpace(_settings.CallbackSecret))
        {
            // Never accept callbacks while no secret is configured.
            return false;
        }

        if (!Request.Headers.TryGetValue(SecretHeaderName, out var provided) || provided.Count != 1)
        {
            return false;
        }

        var providedBytes = Encoding.UTF8.GetBytes(provided.ToString());
        var expectedBytes = Encoding.UTF8.GetBytes(_settings.CallbackSecret);

        return CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }
}
