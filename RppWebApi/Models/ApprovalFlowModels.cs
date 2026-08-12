namespace RppWebApi.Models;

/// <summary>
/// EO-410: configuration for the Power Automate approval flow.
/// FlowUrl and CallbackSecret are secrets (user secrets / Azure app settings per EO-409).
/// </summary>
public class ApprovalFlowSettings
{
    public const string SectionName = "ApprovalFlow";

    public bool Enabled { get; set; }
    public string FlowUrl { get; set; } = string.Empty;
    public string CallbackSecret { get; set; } = string.Empty;
}

/// <summary>
/// EO-410: request body for POST /api/planning/vacationrequests/{id}/start-approval.
/// Mirrors the frontend PowerAutomateApprovalInput contract (EO-200).
/// </summary>
public class StartApprovalRequestDto
{
    public string RequestId { get; set; } = string.Empty;
    public string TeamId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string UserDisplayName { get; set; } = string.Empty;
    public string AbsenceType { get; set; } = "vacation";
    public string StartDate { get; set; } = string.Empty;
    public string StartHalf { get; set; } = "fullDay";
    public string EndDate { get; set; } = string.Empty;
    public string EndHalf { get; set; } = "fullDay";
    public string? Comment { get; set; }
    public string? CommentToApprover { get; set; }
    public string PolicyId { get; set; } = string.Empty;
    public string RoutingRuleId { get; set; } = string.Empty;
    public string ApproverId { get; set; } = string.Empty;
}

/// <summary>
/// EO-410: response of the flow start. Mirrors the frontend PowerAutomateApprovalOutput contract (EO-200).
/// </summary>
public class StartApprovalResponseDto
{
    public string RequestId { get; set; } = string.Empty;
    public string ApprovalReferenceId { get; set; } = string.Empty;
    public string? Decision { get; set; }
    public string? DecisionBy { get; set; }
    public string? DecisionDate { get; set; }
    public string? DecisionComment { get; set; }
    public string FlowRunId { get; set; } = string.Empty;
    public string Status { get; set; } = "pendingApproval"; // pendingApproval, approved, rejected, failed
}

/// <summary>
/// Member-readable approval picker payload for the absence form.
/// Any host-team member may read this — Team Admin details stay owner-gated.
/// </summary>
public class ApprovalOptionsDto
{
    public string? DefaultApproverUserId { get; set; }
    public bool AllowOverride { get; set; } = true;
    public bool ApprovalExempt { get; set; }
    public List<ApprovalCandidateDto> Candidates { get; set; } = new();
}

public class ApprovalCandidateDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
}

/// <summary>
/// EO-410: decision writeback from the Power Automate flow
/// (POST /api/approvals/callback, protected by X-RPP-Approval-Secret).
/// </summary>
public class ApprovalCallbackDto
{
    public string RequestId { get; set; } = string.Empty;
    public string ApprovalReferenceId { get; set; } = string.Empty;
    public string Decision { get; set; } = string.Empty; // approved, rejected
    public string DecisionBy { get; set; } = string.Empty;
    public string DecisionDate { get; set; } = string.Empty;
    public string? DecisionComment { get; set; }
    public string FlowRunId { get; set; } = string.Empty;
}
