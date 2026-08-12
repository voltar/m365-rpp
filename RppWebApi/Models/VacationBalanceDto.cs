namespace RppWebApi.Models;

/// <summary>
/// DTO for Vacation Balance - matches frontend usage
/// </summary>
public class VacationBalanceDto
{
    public string EmployeeId { get; set; } = string.Empty;
    public int Year { get; set; }
    public decimal Entitlement { get; set; }
    public decimal CarryForward { get; set; }
    public decimal ManualAdjustment { get; set; }
    public decimal ApprovedVacation { get; set; }
    public decimal PendingVacation { get; set; }
    public decimal Remaining { get; set; }
    public string? Comment { get; set; }
}