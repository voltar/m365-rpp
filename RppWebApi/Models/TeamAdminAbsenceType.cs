using System;
using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// Configurable absence entry type managed in the Team Admin Center (EO-408).
/// Global for the installation; built-in types carry a LabelKey, custom types a Label.
/// </summary>
public class TeamAdminAbsenceType
{
    [Key]
    [MaxLength(100)]
    public string Key { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Label { get; set; }

    [MaxLength(100)]
    public string? LabelKey { get; set; }

    public bool Active { get; set; } = true;

    public bool RequiresApproval { get; set; } = true;

    public bool ConsumesVacationBalance { get; set; } = false;

    public int SortOrder { get; set; } = 0;

    public DateTime LastModified { get; set; } = DateTime.UtcNow;
}
