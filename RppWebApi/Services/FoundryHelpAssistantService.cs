using Microsoft.Extensions.Options;
using RppWebApi.Models;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace RppWebApi.Services;

/// <summary>
/// EO-450 FR-450.3/FR-450.4: calls the Microsoft Foundry Agent Service, whose agent is
/// configured with File Search over the curated RPP knowledge base.
///
/// Authentication uses the app's Managed Identity via <see cref="IFoundryTokenProvider"/>.
/// No API key exists anywhere in configuration, code or deploy artefact.
///
/// The assistant is read-only: this service sends a question and returns an answer. It
/// exposes no tools and cannot reach any RPP data (FR-450.7). Role-based knowledge and
/// function calling are EO-451.
///
/// The call uses the Foundry Responses API, which references the agent by name in the
/// request body rather than by id in the path. The agent's own instructions and its File
/// Search tool stay server-side; the request only adds the page context, which the service
/// treats as additional instructions rather than as a replacement.
/// </summary>
public sealed class FoundryHelpAssistantService : IHelpAssistantService
{
    private readonly HttpClient _httpClient;
    private readonly IFoundryTokenProvider _tokenProvider;
    private readonly HelpAssistantSettings _settings;
    private readonly ILogger<FoundryHelpAssistantService> _logger;

    public FoundryHelpAssistantService(
        HttpClient httpClient,
        IFoundryTokenProvider tokenProvider,
        IOptions<HelpAssistantSettings> settings,
        ILogger<FoundryHelpAssistantService> logger)
    {
        _httpClient = httpClient;
        _tokenProvider = tokenProvider;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<HelpChatAnswerDto> AskAsync(
        HelpChatRequestDto request,
        string? userObjectId,
        CancellationToken cancellationToken)
    {
        var endpoint = _settings.ProjectEndpoint!.TrimEnd('/');
        var payload = BuildPayload(request);

        using var message = new HttpRequestMessage(
            HttpMethod.Post,
            $"{endpoint}/openai/v1/responses")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };

        var token = await _tokenProvider.GetTokenAsync(cancellationToken);
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await _httpClient.SendAsync(message, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // EO-450 FR-450.10: log the failure without the question text, which may carry
            // personal content. The correlation id in the response is what the user reports.
            _logger.LogWarning(
                "Foundry help request failed with status {StatusCode}.",
                (int)response.StatusCode);

            throw new HelpAssistantUnavailableException(
                $"Foundry returned HTTP {(int)response.StatusCode}.");
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        return ParseAnswer(body);
    }

    private object BuildPayload(HelpChatRequestDto request)
    {
        var items = new List<object>();

        // The page context leads the conversation as a system message. It deliberately does
        // NOT go into the request's `instructions` field: with an agent reference the service
        // rejects that field outright ("Not allowed when agent is specified"), because the
        // agent's own instruction is authoritative. Carrying the context as an input item
        // keeps "why is this red?" answerable (FR-450.5) without touching the agent's
        // grounding and refusal rules (FR-450.6, FR-450.7).
        var context = BuildContextInstruction(request.Context);

        if (!string.IsNullOrWhiteSpace(context))
        {
            items.Add(CreateMessage("system", context));
        }

        foreach (var turn in (request.History ?? new List<HelpChatTurnDto>())
            .Where(turn => !string.IsNullOrWhiteSpace(turn.Content))
            .TakeLast(_settings.MaxHistoryTurns))
        {
            var role = string.Equals(turn.Author, "assistant", StringComparison.OrdinalIgnoreCase)
                ? "assistant"
                : "user";

            items.Add(CreateMessage(role, turn.Content!));
        }

        items.Add(CreateMessage("user", request.Question ?? string.Empty));

        return new
        {
            input = items,
            // The agent carries the model, the system instruction and the File Search tool.
            // Referencing it by name keeps all of that server-side, so the request cannot
            // widen what the assistant may do (FR-450.7).
            agent_reference = new
            {
                name = _settings.AgentName,
                type = "agent_reference"
            }
        };
    }

    /// <summary>
    /// Input items must carry an explicit type once the payload holds more than one of them;
    /// the untyped shorthand is only accepted for a single item.
    ///
    /// The content type is role-dependent: prior assistant turns are replayed as
    /// <c>output_text</c>, everything else as <c>input_text</c>. Sending <c>input_text</c> for
    /// an assistant turn is rejected, which would break every follow-up question in a chat.
    /// </summary>
    private static object CreateMessage(string role, string text)
    {
        if (string.Equals(role, "assistant", StringComparison.Ordinal))
        {
            // An output_text part is additionally required to carry annotations, even empty.
            return new
            {
                type = "message",
                role,
                content = new[]
                {
                    new { type = "output_text", text, annotations = Array.Empty<object>() }
                }
            };
        }

        return new
        {
            type = "message",
            role,
            content = new[] { new { type = "input_text", text } }
        };
    }

    private static string BuildContextInstruction(HelpChatContextDto? context)
    {
        if (context is null)
        {
            return string.Empty;
        }

        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(context.Language))
        {
            parts.Add($"The user's RPP language is {context.Language}. Answer in that language.");
        }

        if (!string.IsNullOrWhiteSpace(context.CurrentPage))
        {
            parts.Add($"The user is currently on the RPP page '{context.CurrentPage}'.");
        }

        if (!string.IsNullOrWhiteSpace(context.UserRole))
        {
            parts.Add($"The user's RPP role is '{context.UserRole}'.");
        }

        // EO-450 KB + Friends & Family refresh: knowledge files may be marked audience: team-owner
        // (Team Admin Center). Only teamLead and appAdmin may receive that guidance.
        var role = context.UserRole?.Trim() ?? string.Empty;
        var isTeamOwnerAudience =
            string.Equals(role, "teamLead", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "appAdmin", StringComparison.OrdinalIgnoreCase);

        if (isTeamOwnerAudience)
        {
            parts.Add(
                "You may use knowledge marked for team owners (audience team-owner), including Team Admin Center topics.");
        }
        else
        {
            parts.Add(
                "Do not use knowledge marked audience team-owner or give Team Admin Center how-to steps. "
                + "If the user asks how to administer a team, say that Team Admin Center is only for "
                + "Microsoft Teams team owners and they should ask their team owner or IT. "
                + "Do not invent admin procedures.");
        }

        parts.Add(
            "Answer only from the provided RPP knowledge sources. If the answer is not there, say you do not know. "
            + "Never mention source code, deployment, secrets, or internal configuration.");

        return string.Join(" ", parts);
    }

    private HelpChatAnswerDto ParseAnswer(string body)
    {
        using var document = JsonDocument.Parse(body);
        var text = ExtractText(document.RootElement);

        if (string.IsNullOrWhiteSpace(text))
        {
            _logger.LogWarning("Foundry help response contained no answer text.");

            return new HelpChatAnswerDto { Content = string.Empty, Unanswered = true };
        }

        return new HelpChatAnswerDto
        {
            Content = text,
            Sources = ExtractSources(document.RootElement),
            Unanswered = false
        };
    }

    private static string ExtractText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var outputText) && outputText.ValueKind == JsonValueKind.String)
        {
            return outputText.GetString() ?? string.Empty;
        }

        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();

        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var part in content.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var partText) && partText.ValueKind == JsonValueKind.String)
                {
                    builder.Append(partText.GetString());
                }
            }
        }

        return builder.ToString();
    }

    /// <summary>
    /// EO-450 FR-450.6: file citations become the source list under the answer. Only the
    /// document title is surfaced - never a storage path, container or internal URL.
    /// </summary>
    private static IReadOnlyList<HelpAnswerSourceDto> ExtractSources(JsonElement root)
    {
        var titles = new List<string>();

        if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in output.EnumerateArray())
            {
                if (!item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var part in content.EnumerateArray())
                {
                    if (!part.TryGetProperty("annotations", out var annotations)
                        || annotations.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var annotation in annotations.EnumerateArray())
                    {
                        if (annotation.TryGetProperty("filename", out var filename)
                            && filename.ValueKind == JsonValueKind.String)
                        {
                            var title = ToDocumentTitle(filename.GetString());

                            if (!string.IsNullOrWhiteSpace(title) && !titles.Contains(title))
                            {
                                titles.Add(title);
                            }
                        }
                    }
                }
            }
        }

        return titles.Select(title => new HelpAnswerSourceDto { Title = title }).ToList();
    }

    private static string ToDocumentTitle(string? filename)
    {
        if (string.IsNullOrWhiteSpace(filename))
        {
            return string.Empty;
        }

        // "absences.de.md" -> "absences". Only the bare document name leaves the backend.
        var name = Path.GetFileName(filename);
        var firstDot = name.IndexOf('.');

        return firstDot > 0 ? name[..firstDot] : name;
    }
}

/// <summary>Raised when the assistant is configured but temporarily unreachable.</summary>
public sealed class HelpAssistantUnavailableException : Exception
{
    public HelpAssistantUnavailableException(string message) : base(message)
    {
    }
}
