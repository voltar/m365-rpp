namespace RppWebApi.Services;

/// <summary>
/// EO-450 FR-450.3/FR-450.4: configuration of the help assistant.
///
/// Deliberately carries no API key. The backend authenticates to the Foundry
/// Agent Service with its Managed Identity, so there is nothing secret to store
/// here and nothing that could leak into a deploy artefact.
/// </summary>
public sealed class HelpAssistantSettings
{
    public const string SectionName = "HelpAssistant";

    /// <summary>Foundry project endpoint, e.g. https://&lt;resource&gt;.services.ai.azure.com/api/projects/&lt;project&gt;.</summary>
    public string? ProjectEndpoint { get; set; }

    /// <summary>
    /// Name of the Foundry agent configured with File Search over the RPP knowledge base.
    /// The Responses API references an agent by name, not by id (agent_reference.name).
    /// </summary>
    public string? AgentName { get; set; }

    /// <summary>Maximum characters accepted in a single question.</summary>
    public int MaxQuestionLength { get; set; } = 1000;

    /// <summary>Number of prior turns forwarded to the agent.</summary>
    public int MaxHistoryTurns { get; set; } = 10;

    /// <summary>
    /// True once the assistant is fully configured. Until then the API answers from the
    /// built-in fallback so the Help tab degrades to a clear message instead of an error.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ProjectEndpoint) && !string.IsNullOrWhiteSpace(AgentName);
}
