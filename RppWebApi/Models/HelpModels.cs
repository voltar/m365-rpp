using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// EO-450 FR-450.5: call context handed in with every question. It is what makes
/// "why is this red?" answerable - the assistant knows which RPP page the user is on.
/// </summary>
public sealed class HelpChatContextDto
{
    [MaxLength(32)]
    public string? Language { get; set; }

    [MaxLength(64)]
    public string? CurrentPage { get; set; }

    [MaxLength(128)]
    public string? WorkspaceId { get; set; }

    [MaxLength(32)]
    public string? UserRole { get; set; }

    [MaxLength(128)]
    public string? SelectedEmployeeId { get; set; }
}

public sealed class HelpChatTurnDto
{
    /// <summary>"user" or "assistant".</summary>
    [MaxLength(16)]
    public string? Author { get; set; }

    [MaxLength(4000)]
    public string? Content { get; set; }
}

public sealed class HelpChatRequestDto
{
    [Required]
    [MaxLength(1000)]
    public string Question { get; set; } = string.Empty;

    public HelpChatContextDto? Context { get; set; }

    public List<HelpChatTurnDto>? History { get; set; }
}

/// <summary>A citation into the knowledge base. Names a navigation path, never a URL (EO-450 FR-450.6).</summary>
public sealed class HelpAnswerSourceDto
{
    public string Title { get; set; } = string.Empty;

    public string? RppPage { get; set; }

    public string? Route { get; set; }
}

public sealed class HelpChatAnswerDto
{
    public string Content { get; set; } = string.Empty;

    public IReadOnlyList<HelpAnswerSourceDto> Sources { get; set; } = Array.Empty<HelpAnswerSourceDto>();

    /// <summary>True when the assistant could not answer from the knowledge base.</summary>
    public bool Unanswered { get; set; }
}

public sealed class HelpFeedbackRequestDto
{
    [Required]
    [MaxLength(128)]
    public string MessageId { get; set; } = string.Empty;

    /// <summary>"helpful" or "notHelpful".</summary>
    [Required]
    [MaxLength(16)]
    public string Rating { get; set; } = string.Empty;

    public HelpChatContextDto? Context { get; set; }
}
