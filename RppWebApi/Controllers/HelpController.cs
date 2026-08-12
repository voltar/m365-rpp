using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web.Resource;
using RppWebApi.Models;
using RppWebApi.Services;
using System.Security.Claims;

namespace RppWebApi.Controllers;

/// <summary>
/// EO-450 FR-450.4: the help assistant endpoint.
///
/// The browser never talks to Foundry and never holds a key - it calls this controller,
/// which reaches the agent with the app's Managed Identity. The endpoint is strictly
/// read-only: it accepts a question and returns an answer. It exposes no tools, touches no
/// planning data, and cannot create, approve or change anything (FR-450.7).
/// </summary>
[ApiController]
[Route("api/help")]
[Authorize]   // EO-405: Entra ID bearer tokens required; local development bypass via ApiSettings:RequireAuthentication=false
[RequiredScope(RequiredScopesConfigurationKey = "AzureAd:Scopes")]
public class HelpController : ControllerBase
{
    private readonly IHelpAssistantService _assistant;
    private readonly HelpAssistantSettings _settings;
    private readonly ILogger<HelpController> _logger;

    public HelpController(
        IHelpAssistantService assistant,
        IOptions<HelpAssistantSettings> settings,
        ILogger<HelpController> logger)
    {
        _assistant = assistant;
        _settings = settings.Value;
        _logger = logger;
    }

    [HttpPost("chat")]
    public async Task<ActionResult<HelpChatAnswerDto>> Chat(
        [FromBody] HelpChatRequestDto request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Question))
        {
            return BadRequest(new { error = "A question is required." });
        }

        if (request.Question.Length > _settings.MaxQuestionLength)
        {
            return BadRequest(new { error = "The question is too long." });
        }

        try
        {
            var answer = await _assistant.AskAsync(request, GetUserObjectId(), cancellationToken);

            return Ok(answer);
        }
        catch (HelpAssistantUnavailableException exception)
        {
            // EO-450 FR-450.10: never log the question itself - it may carry personal content.
            _logger.LogWarning(exception, "Help assistant is unavailable.");

            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "The help assistant is temporarily unavailable."
            });
        }
    }

    /// <summary>
    /// EO-450 FR-450.8: Hilfreich / Nicht hilfreich per answer. The rating steers
    /// documentation curation; the question and answer text are not stored here.
    /// </summary>
    [HttpPost("feedback")]
    public ActionResult Feedback([FromBody] HelpFeedbackRequestDto request)
    {
        if (request.Rating is not ("helpful" or "notHelpful"))
        {
            return BadRequest(new { error = "Rating must be 'helpful' or 'notHelpful'." });
        }

        _logger.LogInformation(
            "Help assistant feedback received. Rating={Rating} Page={Page} Language={Language}",
            request.Rating,
            request.Context?.CurrentPage,
            request.Context?.Language);

        return NoContent();
    }

    private string? GetUserObjectId() =>
        User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
        ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
}
