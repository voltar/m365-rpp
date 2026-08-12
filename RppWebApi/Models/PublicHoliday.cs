namespace RppWebApi.Models;

/// <summary>
/// EO-416: persisted holiday calendar entry (public holidays and school holidays).
/// Matches the frontend PublicHoliday model: Date is a plain "yyyy-MM-dd" key,
/// Location is null for capacity-relevant public holidays and carries the
/// school-holiday location ("SG", "Dübendorf") otherwise.
/// </summary>
public class PublicHoliday
{
    public string Id { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty; // yyyy-MM-dd
    public string Label { get; set; } = string.Empty;
    public string? Location { get; set; }
}
