namespace RppWebApi.Models;

/// <summary>
/// EO-415: configurable organisations and office locations (flat lists, no hierarchy).
/// Member values derive from the Graph profile (companyName / officeLocation) through
/// ProfileValueMapping entries maintained in the Team Admin Center.
/// </summary>
public class PlanningOrganisation
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}

public class PlanningLocation
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}

public class ProfileValueMapping
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = "organisation"; // organisation | location
    public string GraphValue { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
}

public class OrgConfigDto
{
    public List<PlanningOrganisation> Organisations { get; set; } = new();
    public List<PlanningLocation> Locations { get; set; } = new();
    public List<ProfileValueMapping> Mappings { get; set; } = new();
    public List<string> UnmappedOrganisationValues { get; set; } = new();
    public List<string> UnmappedLocationValues { get; set; } = new();
}

public class OrgConfigPatchDto
{
    public List<PlanningOrganisation> Organisations { get; set; } = new();
    public List<PlanningLocation> Locations { get; set; } = new();
    public List<ProfileValueMapping> Mappings { get; set; } = new();
}

/// <summary>EO-416: full-replace payload for the holiday calendar.</summary>
public class HolidayReplaceRequestDto
{
    public List<PublicHoliday> Items { get; set; } = new();
}

/// <summary>
/// EO-418: App Admin access requires an Entra directory role. Defaults:
/// Teams Administrator and Global Administrator role template ids.
/// </summary>
public class AppAdminSettings
{
    public const string SectionName = "AppAdmin";

    public List<string> AllowedRoleTemplateIds { get; set; } = new()
    {
        "69091246-20e8-4a56-aa4d-066075b2a7a8", // Teams Administrator
        "62e90394-69f5-4237-9190-012177145e10"  // Global Administrator
    };

    // Explicit app-admin user object ids (tenant onboarding / when the token lacks
    // the wids claim). Checked in addition to the directory-role check.
    public List<string> AllowedAdminUserIds { get; set; } = new();
}

/// <summary>EO-418: role/ownership summary for the current caller in the active team context.</summary>
public class AccessInfoDto
{
    public bool IsTeamOwner { get; set; }
    public bool IsAppAdmin { get; set; }
    public string? TeamDisplayName { get; set; }

    /// <summary>
    /// EO-428 FR-428.4: whether the caller is a B2B guest in this tenant. Guests are never team
    /// administrators — a decision, not a side effect of Microsoft 365 not letting them own a team.
    /// Reported so the UI can leave those surfaces out instead of showing and then refusing them.
    /// </summary>
    public bool IsGuest { get; set; }
}
