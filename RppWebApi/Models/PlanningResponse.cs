namespace RppWebApi.Models;

/// <summary>
/// Generic wrapper for paginated planning responses
/// </summary>
public class PlanningResponse<T>
{
    public List<T> Items { get; set; } = new();
    public string? NextPageToken { get; set; }
    public int TotalCount { get; set; }
}