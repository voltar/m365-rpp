using RppWebApi.Models;

namespace RppWebApi.Services;

/// <summary>
/// EO-450: answers when no Foundry agent is configured yet (§8 step 3 outstanding) or when
/// the API runs in a demo deployment.
///
/// It deliberately does not invent answers. It returns the same clean "cannot answer"
/// shape the real agent produces for questions outside the knowledge base, so the Help tab
/// stays honest rather than showing an error - and so no answer can ever be fabricated
/// without the knowledge base behind it (FR-450.6).
/// </summary>
public sealed class FallbackHelpAssistantService : IHelpAssistantService
{
    private readonly ILogger<FallbackHelpAssistantService> _logger;

    public FallbackHelpAssistantService(ILogger<FallbackHelpAssistantService> logger)
    {
        _logger = logger;
    }

    public Task<HelpChatAnswerDto> AskAsync(
        HelpChatRequestDto request,
        string? userObjectId,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Help assistant is not configured; returning the unavailable answer. "
            + "Set HelpAssistant:ProjectEndpoint and HelpAssistant:AgentName to enable it.");

        var german = (request.Context?.Language ?? string.Empty)
            .StartsWith("de", StringComparison.OrdinalIgnoreCase);

        return Task.FromResult(new HelpChatAnswerDto
        {
            Content = german
                ? "Die RPP-Hilfe ist in dieser Umgebung noch nicht eingerichtet. Bitte wenden Sie sich an Ihre IT-Administration."
                : "The RPP help is not set up in this environment yet. Please contact your IT administration.",
            Unanswered = true
        });
    }
}
