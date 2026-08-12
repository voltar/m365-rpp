namespace RppWebApi.Models;

/// <summary>
/// DTO for VacationRequest (used in Genehmigungen / Approval workflow)
/// </summary>
public class VacationRequestDto
{
    public string Id { get; set; } = string.Empty;
    public string EmployeeId { get; set; } = string.Empty;
    public string Type { get; set; } = "vacation";
    public DateTime StartDate { get; set; }
    public string StartHalf { get; set; } = "fullDay";
    public DateTime EndDate { get; set; }
    public string EndHalf { get; set; } = "fullDay";
    public decimal Duration { get; set; }
    public string Status { get; set; } = "draft"; // draft, submitted, pendingApproval, approved, rejected, cancelled, failed
    public string? ApproverId { get; set; }
    public string? ApprovalReferenceId { get; set; }
    public bool SyncToOutlook { get; set; } = true;
    public string? Comment { get; set; }
    public DateTime Created { get; set; }
    public DateTime Modified { get; set; }

    // EO-410: approval workflow fields for the API-based Microsoft 365 integration
    public string TeamId { get; set; } = string.Empty;
    public string UserDisplayName { get; set; } = string.Empty;
    public string? CommentToApprover { get; set; }
    public string ApprovalProvider { get; set; } = "none"; // none, microsoftApprovals
    public string? FlowRunId { get; set; }
    public string? DecisionBy { get; set; }
    public DateTime? DecisionDate { get; set; }
    public string? DecisionComment { get; set; }

    // EO-414: one-way Outlook calendar sync state (RPP → requester's personal calendar)
    public string? GraphEventId { get; set; }
    public string OutlookSyncStatus { get; set; } = "notRequired"; // notRequired, pending, synced, failed
    public string? OutlookSyncError { get; set; }
}