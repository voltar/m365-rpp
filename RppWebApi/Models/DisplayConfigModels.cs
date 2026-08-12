using System;
using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// EO-421: tenant-wide display settings maintained from the Team Admin Center.
/// Single-row table (fixed id) — presentation preferences only, no planning data.
/// </summary>
public class PlanningDisplaySettings
{
    public const string SingletonId = "default";

    [Key]
    [MaxLength(20)]
    public string Id { get; set; } = SingletonId;

    public bool ShowVacationSummary { get; set; } = true;

    // EO-423: how planning events are colored — "byType" (default) | "byTeam".
    [MaxLength(20)]
    public string EventColorMode { get; set; } = "byType";

    public DateTime LastModified { get; set; } = DateTime.UtcNow;
}

public class DisplayConfigDto
{
    public bool ShowVacationSummary { get; set; } = true;
    public string EventColorMode { get; set; } = "byType";
}

/// <summary>Patch semantics: only non-null values are applied.</summary>
public class DisplayConfigPatchDto
{
    public bool? ShowVacationSummary { get; set; }
    public string? EventColorMode { get; set; }
}
