namespace RppWebApi.Models;

/// <summary>
/// DTO for general planning events (non-absence)
/// </summary>
public class PlanningEventDto
{
    public string Id { get; set; } = string.Empty;
    public string EmployeeId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;        // training, maintenance, oncall, standby, project...
    public string Title { get; set; } = string.Empty;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public string? Comment { get; set; }
    public DateTime Created { get; set; }
    public DateTime Modified { get; set; }
}