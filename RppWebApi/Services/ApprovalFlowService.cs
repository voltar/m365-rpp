using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using RppWebApi.Models;

namespace RppWebApi.Services;

/// <summary>
/// EO-410: server-side call of the Power Automate approval flow.
/// The SAS-signed flow URL never leaves the server.
/// </summary>
public class ApprovalFlowService
{
    private static readonly string[] AllowedFlowHostSuffixes =
    {
        ".logic.azure.com",
        ".api.powerplatform.com"
    };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly ApprovalFlowSettings _settings;
    private readonly ILogger<ApprovalFlowService> _logger;

    public ApprovalFlowService(
        HttpClient httpClient,
        IOptions<ApprovalFlowSettings> settings,
        ILogger<ApprovalFlowService> logger)
    {
        _httpClient = httpClient;
        _settings = settings.Value;
        _logger = logger;
    }

    public bool IsConfigured =>
        _settings.Enabled
        && !string.IsNullOrWhiteSpace(_settings.FlowUrl)
        && IsAllowedFlowUrl(_settings.FlowUrl);

    public async Task<StartApprovalResponseDto?> StartApprovalAsync(StartApprovalRequestDto input, CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("Approval flow start requested but ApprovalFlow configuration is missing or invalid (Enabled={Enabled}).", _settings.Enabled);
            return null;
        }

        using var content = new StringContent(JsonSerializer.Serialize(input, JsonOptions), Encoding.UTF8, "application/json");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));

        try
        {
            var response = await _httpClient.PostAsync(_settings.FlowUrl, content, timeout.Token);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Approval flow returned HTTP {StatusCode} for request {RequestId}.", (int)response.StatusCode, input.RequestId);
                return null;
            }

            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            var output = JsonSerializer.Deserialize<StartApprovalResponseDto>(body, JsonOptions);

            if (output is null || string.IsNullOrWhiteSpace(output.ApprovalReferenceId))
            {
                _logger.LogError("Approval flow response for request {RequestId} did not match the EO-200 output contract.", input.RequestId);
                return null;
            }

            return output;
        }
        catch (Exception exception) when (exception is OperationCanceledException or HttpRequestException or JsonException)
        {
            _logger.LogError(exception, "Approval flow call failed for request {RequestId}.", input.RequestId);
            return null;
        }
    }

    private static bool IsAllowedFlowUrl(string flowUrl)
    {
        if (!Uri.TryCreate(flowUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            return false;
        }

        return AllowedFlowHostSuffixes.Any(suffix => uri.Host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
    }
}
