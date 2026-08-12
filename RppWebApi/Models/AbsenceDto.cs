namespace RppWebApi.Models;

/// <summary>
/// DTO for Absence - matches the frontend Absence model
/// </summary>
public class AbsenceDto
{
    public string Id { get; set; } = string.Empty;
    public string EmployeeId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;           // e.g. "vacation", "homeoffice"
    public DateTime StartDate { get; set; }
    public string StartHalf { get; set; } = "full";            // full, morning, afternoon
    public DateTime EndDate { get; set; }
    public string EndHalf { get; set; } = "full";
    public decimal Duration { get; set; }                       // working days
    public string? Substitute { get; set; }
    public string? Comment { get; set; }
    public string Status { get; set; } = "approved";           // lifecycle: approved, deleted (soft delete)
    public DateTime Created { get; set; }
    public DateTime Modified { get; set; }

    // EO-410: approval workflow state as shown on the Timeline (draft, pendingApproval, approved, rejected)
    public string ApprovalStatus { get; set; } = "approved";
    // EO-410: link to the vacation request so the flow decision updates this row instead of duplicating it
    public string? VacationRequestId { get; set; }

    // EO-424: inbound Outlook mailbox sync — unique iCalendar UID for update/cancel matching
    public string? IcsUid { get; set; }
    // EO-424: data provenance marker (e.g. "manual", "outlook-mailbox", "teams-app")
    public string Source { get; set; } = "manual";
}