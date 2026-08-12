using System;
using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// Team-level configuration for a holiday/school-holiday calendar slot.
/// EO-454: Supports up to 3 public + 3 school holiday slots per team with customizable
/// source type, source URL, display label, and color tone.
/// </summary>
public class HolidayCalendarSlot
{
    /// <summary>
    /// Unique slot identifier (e.g., "public-1", "school-2").
    /// </summary>
    [Key]
    [MaxLength(50)]
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Team this slot belongs to.
    /// </summary>
    [MaxLength(50)]
    public string TeamId { get; set; } = string.Empty;

    /// <summary>
    /// Slot kind: "public" (affects capacity) or "school" (overlay only).
    /// </summary>
    [MaxLength(20)]
    public string Kind { get; set; } = string.Empty; // "public" | "school"

    /// <summary>
    /// Whether this slot is enabled for loading/rendering.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// User-friendly display label for this slot (e.g., "Feiertage Zürich").
    /// </summary>
    [MaxLength(200)]
    public string DisplayLabel { get; set; } = string.Empty;

    /// <summary>
    /// Tone/color key for rendering (e.g., "publicHoliday1", "schoolHoliday2").
    /// Validated against the UI color palette.
    /// </summary>
    [MaxLength(50)]
    public string Tone { get; set; } = string.Empty;

    /// <summary>
    /// Source type: "microsoft" (preset), "json" (HTTP JSON), or "ics" (HTTP iCalendar).
    /// </summary>
    [MaxLength(20)]
    public string SourceType { get; set; } = "microsoft"; // "microsoft" | "json" | "ics"

    /// <summary>
    /// Source URL for JSON or ICS sources. Null for "microsoft" preset type.
    /// May include year placeholders: {year}, {YYYY}, {YY}.
    /// </summary>
    [MaxLength(2000)]
    public string? SourceUrl { get; set; }

    /// <summary>
    /// Microsoft preset (e.g., "zurich-public", "st-gallen-school").
    /// Only used when SourceType == "microsoft".
    /// </summary>
    [MaxLength(100)]
    public string? MicrosoftPreset { get; set; }

    /// <summary>
    /// Last modified timestamp (UTC).
    /// </summary>
    public DateTime LastModified { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Navigation: Team this slot belongs to.
    /// </summary>
    public TeamAdminTeam Team { get; set; } = null!;
}
