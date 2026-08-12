using System;
using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// Junction / Assignment table for Team <-> Member (normalized, EO-408).
/// Supports Primary Team + multiple Additional Positions (Zusatzposition).
/// This is the core of "existing team members after selecting team".
/// </summary>
public class TeamAdminMemberAssignment
{
    [Key]
    public int Id { get; set; }

    [MaxLength(100)]
    public string UserId { get; set; } = string.Empty; // From Graph (Entra ID)

    [MaxLength(50)]
    public string TeamId { get; set; } = string.Empty;

    public bool IsPrimary { get; set; } = false;

    [MaxLength(200)]
    public string? AdditionalPosition { get; set; } // e.g. "M365 Platform", "On Call" – allows multiple rows per user/team

    public decimal? EmploymentPercentage { get; set; } = 100;

    public decimal VacationBalance { get; set; } = 25;

    public bool ApprovalExempt { get; set; } = false;

    [MaxLength(100)]
    public string? EffectiveApproverUserId { get; set; }

    public DateTime LastModified { get; set; } = DateTime.UtcNow;

    // Navigation
    public TeamAdminTeam Team { get; set; } = null!;
}
