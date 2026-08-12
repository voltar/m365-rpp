using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;
using RppWebApi.Models;

namespace RppWebApi.Services;

/// <summary>
/// EO-414: one-way Outlook calendar sync (RPP → requester's personal calendar).
/// Uses the application permission Calendars.ReadWrite (app-only token) because
/// approval decisions arrive via pull sync in an arbitrary caller's context.
/// One all-day event per vacation request; failures never block the approval flow.
/// </summary>
public class OutlookCalendarSyncService
{
    private const string GraphBaseUrl = "https://graph.microsoft.com/v1.0";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly OutlookSyncSettings _settings;
    private readonly ILogger<OutlookCalendarSyncService> _logger;

    public OutlookCalendarSyncService(
        HttpClient httpClient,
        ITokenAcquisition tokenAcquisition,
        IOptions<OutlookSyncSettings> settings,
        ILogger<OutlookCalendarSyncService> logger)
    {
        _httpClient = httpClient;
        _tokenAcquisition = tokenAcquisition;
        _settings = settings.Value;
        _logger = logger;
    }

    public bool IsEnabled => _settings.Enabled;

    public bool TentativeOnSubmit => _settings.Enabled && _settings.TentativeOnSubmit;

    /// <summary>
    /// Applies the calendar side effect for the request's current status and mutates
    /// the sync fields on the DTO. The caller persists the request afterwards.
    /// </summary>
    public async Task ApplyLifecycleAsync(VacationRequestDto request, CancellationToken cancellationToken = default)
    {
        if (!_settings.Enabled || !request.SyncToOutlook)
        {
            _logger.LogInformation(
                "Outlook sync skipped for request {RequestId} (enabled={Enabled}, syncToOutlook={SyncToOutlook}).",
                request.Id, _settings.Enabled, request.SyncToOutlook);
            return;
        }

        _logger.LogInformation(
            "Outlook sync lifecycle for request {RequestId}: status={Status}, tentativeOnSubmit={Tentative}, hasEvent={HasEvent}.",
            request.Id, request.Status, _settings.TentativeOnSubmit, !string.IsNullOrEmpty(request.GraphEventId));

        try
        {
            switch (request.Status)
            {
                case "pendingApproval" when _settings.TentativeOnSubmit:
                    await UpsertEventAsync(request, tentative: true, cancellationToken);
                    break;
                case "approved":
                    await UpsertEventAsync(request, tentative: false, cancellationToken);
                    break;
                case "rejected":
                case "cancelled":
                    await DeleteEventAsync(request, cancellationToken);
                    break;
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(exception, "Outlook sync failed for vacation request {RequestId}.", request.Id);
            request.OutlookSyncStatus = "failed";
            request.OutlookSyncError = exception.Message;
        }
    }

    private async Task UpsertEventAsync(VacationRequestDto request, bool tentative, CancellationToken cancellationToken)
    {
        var subjectSuffix = tentative ? " (beantragt)" : "";
        var bodyText = string.IsNullOrWhiteSpace(request.Comment)
            ? "Über RPP (Ressourcen- & Präsenzplanung) erfasst."
            : request.Comment;
        // EO-421: link the event back to the request inside RPP when configured.
        var deepLink = BuildRppDeepLink(request.Id);
        object eventBody = deepLink is null
            ? new { contentType = "text", content = bodyText }
            : new
            {
                contentType = "html",
                content = $"<p>{System.Net.WebUtility.HtmlEncode(bodyText)}</p><p><a href=\"{deepLink}\">In RPP öffnen</a></p>"
            };
        var payload = new
        {
            subject = $"Abwesenheit: {ToSubject(request.Type)}{subjectSuffix}",
            body = eventBody,
            isAllDay = true,
            showAs = tentative ? "tentative" : "oof",
            start = new { dateTime = request.StartDate.ToString("yyyy-MM-dd"), timeZone = "W. Europe Standard Time" },
            // all-day events use an exclusive end date
            end = new { dateTime = request.EndDate.AddDays(1).ToString("yyyy-MM-dd"), timeZone = "W. Europe Standard Time" }
        };

        var token = await _tokenAcquisition.GetAccessTokenForAppAsync("https://graph.microsoft.com/.default");
        var isUpdate = !string.IsNullOrEmpty(request.GraphEventId);
        var url = isUpdate
            ? $"{GraphBaseUrl}/users/{Uri.EscapeDataString(request.EmployeeId)}/events/{Uri.EscapeDataString(request.GraphEventId!)}"
            : $"{GraphBaseUrl}/users/{Uri.EscapeDataString(request.EmployeeId)}/calendar/events";

        using var httpRequest = new HttpRequestMessage(isUpdate ? HttpMethod.Patch : HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
        };
        httpRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(httpRequest, cancellationToken);

        if (isUpdate && response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // The linked event was deleted manually in Outlook — create a fresh one.
            request.GraphEventId = null;
            await UpsertEventAsync(request, tentative, cancellationToken);
            return;
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Outlook event upsert returned HTTP {StatusCode} for request {RequestId}: {Body}",
                (int)response.StatusCode, request.Id, Truncate(body));
            request.OutlookSyncStatus = "failed";
            request.OutlookSyncError = $"HTTP {(int)response.StatusCode}";
            return;
        }

        if (!isUpdate)
        {
            request.GraphEventId = JsonNode.Parse(body)?["id"]?.GetValue<string>();
        }

        request.OutlookSyncStatus = "synced";
        request.OutlookSyncError = null;
        _logger.LogInformation("Outlook event {Action} for vacation request {RequestId}.", isUpdate ? "updated" : "created", request.Id);
    }

    private async Task DeleteEventAsync(VacationRequestDto request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(request.GraphEventId))
        {
            request.OutlookSyncStatus = "notRequired";
            return;
        }

        var token = await _tokenAcquisition.GetAccessTokenForAppAsync("https://graph.microsoft.com/.default");
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(request.EmployeeId)}/events/{Uri.EscapeDataString(request.GraphEventId)}";

        using var httpRequest = new HttpRequestMessage(HttpMethod.Delete, url);
        httpRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(httpRequest, cancellationToken);

        if (response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            request.GraphEventId = null;
            request.OutlookSyncStatus = "notRequired";
            request.OutlookSyncError = null;
            _logger.LogInformation("Outlook event removed for vacation request {RequestId}.", request.Id);
            return;
        }

        _logger.LogError("Outlook event delete returned HTTP {StatusCode} for request {RequestId}.", (int)response.StatusCode, request.Id);
        request.OutlookSyncStatus = "failed";
        request.OutlookSyncError = $"HTTP {(int)response.StatusCode}";
    }

    private static string ToSubject(string absenceType)
    {
        return absenceType switch
        {
            "vacation" => "Ferien",
            "compensation" => "Kompensation",
            "training" => "Ausbildung",
            "education" => "Weiterbildung",
            "military" => "Militär",
            "unpaidLeave" => "Unbezahlter Urlaub",
            _ => absenceType
        };
    }

    // EO-421: Teams entity deep link carrying the request id as subEntityId; the
    // SPA opens "Meine Anträge" and highlights the request (AppShell deep-link handling).
    private string? BuildRppDeepLink(string requestId)
    {
        if (string.IsNullOrWhiteSpace(_settings.TeamsAppId) || string.IsNullOrWhiteSpace(_settings.TabEntityId))
        {
            return null;
        }

        var context = Uri.EscapeDataString($"{{\"subEntityId\":\"{requestId}\"}}");

        return $"https://teams.microsoft.com/l/entity/{Uri.EscapeDataString(_settings.TeamsAppId)}/{Uri.EscapeDataString(_settings.TabEntityId)}?context={context}";
    }

    private static string Truncate(string value)
    {
        return value.Length > 500 ? value[..500] : value;
    }
}

public class OutlookSyncSettings
{
    public const string SectionName = "OutlookSync";

    public bool Enabled { get; set; }
    public bool TentativeOnSubmit { get; set; } = true;

    // EO-421: Teams deep link back to the RPP tab ("In RPP öffnen" in the synced
    // event body). TeamsAppId is the installed app's catalog/manifest id and is
    // installation-specific (see the onboarding parameter sheet); TabEntityId is
    // the static tab entityId from the Teams manifest. An empty TeamsAppId keeps
    // the plain-text body without a link.
    public string TeamsAppId { get; set; } = string.Empty;
    public string TabEntityId { get; set; } = "rpp-planning";
}
