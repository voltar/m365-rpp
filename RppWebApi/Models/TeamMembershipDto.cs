namespace RppWebApi.Models;

/// <summary>
/// DTO for TeamMembership - matches frontend TeamMembership model
/// </summary>
public class TeamMembershipDto
{
    public string Id { get; set; } = string.Empty;
    public TeamMemberDto Member { get; set; } = new();
    public string TeamId { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;
    public bool IsPrimary { get; set; } = false;
}

public class TeamMemberDto
{
    public string Id { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? Mail { get; set; }
    public string Initials { get; set; } = string.Empty;
    // EO-415: resolved via the configured ProfileValueMappings (raw values kept for the
    // Team Admin mapping card).
    public string Organization { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string? RawOrganizationValue { get; set; }
    public string? RawLocationValue { get; set; }
    public bool IsGuest { get; set; } = false;
    public bool IsOwner { get; set; } = false;
}
/// <summary>
/// EO-428: a Microsoft 365 team the signed-in user belongs to, offered for selection when no host
/// context tells the app which team to show.
/// </summary>
public class UserTeamDto
{
    public string TeamId { get; set; } = string.Empty;
    public string TeamName { get; set; } = string.Empty;

    /// <summary>
    /// The caller's primary team per the planning assignments. The picker preselects it, which is
    /// the Product Owner decision for the personal scope — zero clicks for the common case.
    /// </summary>
    public bool IsPrimary { get; set; }
}
