using System.Text.Json;

namespace RppWebApi.Services;

/// <summary>
/// EO-450 FR-450.4: supplies the bearer token the backend uses against the Foundry
/// Agent Service. Managed Identity only - there is deliberately no key-based path.
/// </summary>
public interface IFoundryTokenProvider
{
    Task<string> GetTokenAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Acquires a token from the App Service / Container Apps managed identity endpoint.
///
/// Uses the platform-injected IDENTITY_ENDPOINT and IDENTITY_HEADER rather than a client
/// library, so no additional dependency enters the deploy artefact and nothing
/// key-shaped can be configured by mistake. Tokens are cached until shortly before expiry.
/// </summary>
public sealed class ManagedIdentityFoundryTokenProvider : IFoundryTokenProvider
{
    private const string Resource = "https://ai.azure.com";
    private const string ImdsApiVersion = "2019-08-01";

    private readonly HttpClient _httpClient;
    private readonly ILogger<ManagedIdentityFoundryTokenProvider> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private string? _cachedToken;
    private DateTimeOffset _expiresOn = DateTimeOffset.MinValue;

    public ManagedIdentityFoundryTokenProvider(
        HttpClient httpClient,
        ILogger<ManagedIdentityFoundryTokenProvider> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<string> GetTokenAsync(CancellationToken cancellationToken)
    {
        if (_cachedToken is not null && DateTimeOffset.UtcNow < _expiresOn.AddMinutes(-5))
        {
            return _cachedToken;
        }

        await _lock.WaitAsync(cancellationToken);

        try
        {
            if (_cachedToken is not null && DateTimeOffset.UtcNow < _expiresOn.AddMinutes(-5))
            {
                return _cachedToken;
            }

            var identityEndpoint = Environment.GetEnvironmentVariable("IDENTITY_ENDPOINT");
            var identityHeader = Environment.GetEnvironmentVariable("IDENTITY_HEADER");

            if (string.IsNullOrWhiteSpace(identityEndpoint) || string.IsNullOrWhiteSpace(identityHeader))
            {
                throw new HelpAssistantUnavailableException(
                    "No managed identity endpoint is available. The help assistant requires a system-assigned "
                    + "or user-assigned managed identity with access to the Foundry resource.");
            }

            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"{identityEndpoint}?resource={Uri.EscapeDataString(Resource)}&api-version={ImdsApiVersion}");
            request.Headers.Add("X-IDENTITY-HEADER", identityHeader);

            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Managed identity token request failed with status {StatusCode}.",
                    (int)response.StatusCode);

                throw new HelpAssistantUnavailableException("Managed identity token request failed.");
            }

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var root = document.RootElement;

            var token = root.TryGetProperty("access_token", out var accessToken)
                ? accessToken.GetString()
                : null;

            if (string.IsNullOrWhiteSpace(token))
            {
                throw new HelpAssistantUnavailableException("Managed identity response carried no access token.");
            }

            _cachedToken = token;
            _expiresOn = ReadExpiry(root);

            return token;
        }
        finally
        {
            _lock.Release();
        }
    }

    private static DateTimeOffset ReadExpiry(JsonElement root)
    {
        if (root.TryGetProperty("expires_on", out var expiresOn))
        {
            if (expiresOn.ValueKind == JsonValueKind.String
                && long.TryParse(expiresOn.GetString(), out var asString))
            {
                return DateTimeOffset.FromUnixTimeSeconds(asString);
            }

            if (expiresOn.ValueKind == JsonValueKind.Number && expiresOn.TryGetInt64(out var asNumber))
            {
                return DateTimeOffset.FromUnixTimeSeconds(asNumber);
            }
        }

        // Without a usable expiry, keep the token only briefly rather than indefinitely.
        return DateTimeOffset.UtcNow.AddMinutes(10);
    }
}
