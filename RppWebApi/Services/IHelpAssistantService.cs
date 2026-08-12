using RppWebApi.Models;

namespace RppWebApi.Services;

/// <summary>
/// EO-450: read-only help assistant. Implementations answer exclusively from the
/// curated RPP knowledge base and never perform write actions (FR-450.7).
/// </summary>
public interface IHelpAssistantService
{
    Task<HelpChatAnswerDto> AskAsync(
        HelpChatRequestDto request,
        string? userObjectId,
        CancellationToken cancellationToken);
}
