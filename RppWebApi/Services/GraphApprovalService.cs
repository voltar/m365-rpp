using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;
using RppWebApi.Models;

namespace RppWebApi.Services;

public interface IGraphApprovalService
{
    bool IsEnabled { get; }

    Task<string?> CreateApprovalAsync(
        string title,
        string description,
        string approverUserId,
        CancellationToken cancellationToken = default);

    Task<GraphApprovalStatus?> GetApprovalStatusAsync(
        string approvalItemId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// EO-410 (Graph provider): creates and reads Microsoft Approvals directly via the
/// Microsoft Graph approval solutions API (beta) using the caller's delegated context
/// (OBO with the Teams SSO token). No Power Automate and no premium license required.
/// The approver decides in the regular Teams Approvals app.
/// </summary>
public class GraphApprovalService : IGraphApprovalService
{
    private const string GraphRoot = "https://graph.microsoft.com";
    private const string ApprovalItemsUrl = GraphRoot + "/beta/solutions/approval/approvalItems";
    private static readonly string[] GraphScopes = { "https://graph.microsoft.com/ApprovalSolution.ReadWrite" };
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly GraphApprovalSettings _settings;
    private readonly ILogger<GraphApprovalService> _logger;

    public GraphApprovalService(
        HttpClient httpClient,
        ITokenAcquisition tokenAcquisition,
        IOptions<GraphApprovalSettings> settings,
        ILogger<GraphApprovalService> logger)
    {
        _httpClient = httpClient;
        _tokenAcquisition = tokenAcquisition;
        _settings = settings.Value;
        _logger = logger;
    }

    public bool IsEnabled => _settings.Enabled;

    /// <summary>
    /// Creates a basic approval item assigned to the approver (Graph user id).
    /// Returns the approval item id, or null when creation failed.
    /// </summary>
    public async Task<string?> CreateApprovalAsync(
        string title,
        string description,
        string approverUserId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(approverUserId) || !Guid.TryParse(approverUserId.Trim(), out _))
        {
            _logger.LogError(
                "Graph approval creation refused: approver id is not a Graph object id (value='{ApproverId}').",
                approverUserId);
            return null;
        }

        var normalizedApproverId = approverUserId.Trim();

        try
        {
            var token = await _tokenAcquisition.GetAccessTokenForUserAsync(GraphScopes);
            // Same shape that already creates ApprovalGraphAPI items in this tenant.
            // Approver must be the Entra object id (GUID), including B2B guests in the host tenant.
            var payload = new
            {
                displayName = title,
                description,
                approvalType = "basic",
                allowEmailNotification = true,
                approvers = new[] { new { user = new { id = normalizedApproverId } } }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, ApprovalItemsUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            _logger.LogInformation(
                "Creating Graph approval for approver {ApproverId} title={Title}",
                normalizedApproverId,
                title);

            var response = await _httpClient.SendAsync(request, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError("Graph approval creation returned HTTP {StatusCode}: {Body}", (int)response.StatusCode, body);
                return null;
            }

            // 202 Accepted: Location points at a long-running operation. 201 may return the item body.
            // Location is often a *relative* path (/beta/...) — HttpClient has no BaseAddress, so
            // relative URLs must be expanded or polling silently fails → approvalFlowStartFailed.
            var operationUrl = ToAbsoluteGraphUrl(response.Headers.Location?.ToString());

            if (string.IsNullOrEmpty(operationUrl))
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    if (doc.RootElement.TryGetProperty("id", out var idProp))
                    {
                        var directId = idProp.GetString();
                        if (!string.IsNullOrWhiteSpace(directId))
                        {
                            _logger.LogInformation("Graph approval created directly with id {ApprovalItemId}.", directId);
                            return directId;
                        }
                    }
                }
                catch (JsonException)
                {
                    // fall through
                }

                _logger.LogError(
                    "Graph approval creation returned HTTP {StatusCode} without operation Location or item id. Body={Body}",
                    (int)response.StatusCode,
                    body);
                return null;
            }

            _logger.LogInformation("Graph approval operation URL: {OperationUrl}", operationUrl);

            var approvalItemId = await ResolveApprovalItemIdAsync(operationUrl, token, cancellationToken);
            if (!string.IsNullOrWhiteSpace(approvalItemId))
            {
                _logger.LogInformation(
                    "Graph approval provisioned id={ApprovalItemId} for approver {ApproverId}.",
                    approvalItemId,
                    normalizedApproverId);
            }
            else
            {
                _logger.LogError(
                    "Graph approval operation did not yield an item id (approver={ApproverId}, operation={OperationUrl}).",
                    normalizedApproverId,
                    operationUrl);
            }

            return approvalItemId;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Typical Host Europe / new app: AADSTS65001 = ApprovalSolution.ReadWrite not in the
            // admin-consent grant for this app registration (run configure-graph-approvals.ps1).
            _logger.LogError(
                exception,
                "Graph approval creation failed (OBO/consent: ApprovalSolution.ReadWrite). {ExceptionType}: {Message}",
                exception.GetType().Name,
                exception.Message);
            return null;
        }
    }

    /// <summary>
    /// Reads the current state of an approval item. Returns null when the item cannot
    /// be read in the caller's context (e.g. another user's approval, or Graph errors).
    /// </summary>
    public async Task<GraphApprovalStatus?> GetApprovalStatusAsync(string approvalItemId, CancellationToken cancellationToken = default)
    {
        try
        {
            var token = await _tokenAcquisition.GetAccessTokenForUserAsync(GraphScopes);
            var item = await GetJsonAsync($"{ApprovalItemsUrl}/{Uri.EscapeDataString(approvalItemId)}", token, cancellationToken);

            if (item is null)
            {
                _logger.LogWarning(
                    "Graph approval {ApprovalItemId} could not be read (null/404/403). It will stay pending in RPP and may be invisible in the Approvals app for this user.",
                    approvalItemId);
                return null;
            }

            var status = new GraphApprovalStatus
            {
                State = item["state"]?.GetValue<string>() ?? "pending",
                Result = item["result"]?.GetValue<string>(),
                CompletedDateTime = item["completedDateTime"]?.GetValue<string>()
            };

            // Always log identity of the item so field diagnosis can match Approvals UI
            // (Received vs Sent, which account is assigned).
            var approverSummary = SummarizeApprovers(item);
            _logger.LogInformation(
                "Graph approval {ApprovalItemId}: state={State}, result={Result}, approvers=[{Approvers}], displayName={DisplayName}",
                approvalItemId,
                status.State,
                status.Result ?? "-",
                approverSummary,
                item["displayName"]?.GetValue<string>() ?? "-");

            if (!string.Equals(status.State, "completed", StringComparison.OrdinalIgnoreCase))
            {
                return status;
            }

            var responses = await GetJsonAsync($"{ApprovalItemsUrl}/{Uri.EscapeDataString(approvalItemId)}/responses", token, cancellationToken);
            var firstResponse = responses?["value"] is JsonArray { Count: > 0 } array ? array[0] : null;

            if (firstResponse is not null)
            {
                status.ResponseValue = firstResponse["response"]?.GetValue<string>();
                status.DecisionComment = firstResponse["comments"]?.GetValue<string>();
                status.DecisionBy =
                    firstResponse["createdBy"]?["user"]?["displayName"]?.GetValue<string>()
                    ?? firstResponse["createdBy"]?["user"]?["id"]?.GetValue<string>();
            }

            // Diagnostics: the raw values decide approve vs. reject — make them visible.
            _logger.LogInformation(
                "Graph approval {ApprovalItemId} completed: state={State}, result={Result}, response={Response}.",
                approvalItemId, status.State, status.Result ?? "-", status.ResponseValue ?? "-");

            return status;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(exception, "Graph approval status read failed for {ApprovalItemId}.", approvalItemId);
            return null;
        }
    }

    private async Task<string?> ResolveApprovalItemIdAsync(string operationUrl, string token, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(attempt == 0 ? 1 : 2), cancellationToken);

            var operation = await GetJsonAsync(operationUrl, token, cancellationToken);
            var status = operation?["status"]?.GetValue<string>();

            if (string.Equals(status, "succeeded", StringComparison.OrdinalIgnoreCase))
            {
                var resourceLocation = operation?["resourceLocation"]?.GetValue<string>();

                if (string.IsNullOrEmpty(resourceLocation))
                {
                    _logger.LogError("Graph approval operation succeeded but has no resourceLocation.");
                    return null;
                }

                return resourceLocation.TrimEnd('/').Split('/').Last();
            }

            if (string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogError("Graph approval operation failed: {Operation}", operation?.ToJsonString());
                return null;
            }
        }

        _logger.LogError("Graph approval operation did not complete within the polling window.");
        return null;
    }

    private async Task<JsonNode?> GetJsonAsync(string url, string token, CancellationToken cancellationToken)
    {
        var absoluteUrl = ToAbsoluteGraphUrl(url);
        if (string.IsNullOrEmpty(absoluteUrl))
        {
            _logger.LogWarning("Graph GET skipped: empty or invalid url '{Url}'.", url);
            return null;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, absoluteUrl);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning(
                "Graph GET {Url} returned HTTP {StatusCode}: {Body}",
                absoluteUrl,
                (int)response.StatusCode,
                errorBody.Length > 500 ? errorBody[..500] : errorBody);
            return null;
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return JsonNode.Parse(body);
    }

    /// <summary>
    /// Graph returns Location / resourceLocation as absolute or root-relative URLs.
    /// Relative values must be rooted at graph.microsoft.com for HttpClient without BaseAddress.
    /// </summary>
    internal static string? ToAbsoluteGraphUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return null;
        }

        var trimmed = url.Trim();

        if (Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute))
        {
            return absolute.ToString();
        }

        if (trimmed.StartsWith('/'))
        {
            return GraphRoot + trimmed;
        }

        return GraphRoot + "/" + trimmed.TrimStart('/');
    }

    private static string SummarizeApprovers(JsonNode item)
    {
        try
        {
            if (item["approvers"] is not JsonArray approvers || approvers.Count == 0)
            {
                return "-";
            }

            var parts = new List<string>();
            foreach (var entry in approvers)
            {
                if (entry is null)
                {
                    continue;
                }

                var id = entry["user"]?["id"]?.GetValue<string>()
                    ?? entry["id"]?.GetValue<string>();
                var name = entry["user"]?["displayName"]?.GetValue<string>()
                    ?? entry["displayName"]?.GetValue<string>();

                if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(id))
                {
                    parts.Add($"{name} ({id})");
                }
                else if (!string.IsNullOrWhiteSpace(id))
                {
                    parts.Add(id);
                }
                else if (!string.IsNullOrWhiteSpace(name))
                {
                    parts.Add(name);
                }
            }

            return parts.Count == 0 ? "-" : string.Join("; ", parts);
        }
        catch
        {
            return "?";
        }
    }
}

public class GraphApprovalSettings
{
    public const string SectionName = "GraphApprovals";

    public bool Enabled { get; set; }
}

public class GraphApprovalStatus
{
    public string State { get; set; } = "pending"; // created, pending, completed, canceled
    public string? Result { get; set; }            // Approved | Rejected (basic approvals; may vary/localize)
    public string? ResponseValue { get; set; }     // raw response prompt value ("Approve"/"Reject", possibly localized)
    public string? CompletedDateTime { get; set; }
    public string? DecisionBy { get; set; }
    public string? DecisionComment { get; set; }

    /// <summary>
    /// Robust approve detection: Graph documents "Approved"/"Rejected" for basic
    /// approvals, but the observable values follow the response prompts
    /// ("Approve"/"Reject") and can be localized ("Genehmigen"/"Genehmigt").
    /// </summary>
    public bool IsApproved()
    {
        return IsApproveValue(Result) || IsApproveValue(ResponseValue);
    }

    private static bool IsApproveValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var normalized = value.Trim().ToLowerInvariant();

        return normalized.StartsWith("approv") || normalized.StartsWith("genehmig") || normalized.StartsWith("accept");
    }
}
