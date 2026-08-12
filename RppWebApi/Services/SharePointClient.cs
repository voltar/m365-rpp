using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;

namespace RppWebApi.Services;

/// <summary>
/// EO-430: the SharePoint REST boundary for the server-side planning store.
///
/// Every call goes to the one configured site and nowhere else. The guard is not decoration: a list
/// name or a page token that reached this class from request input must never be able to redirect a
/// call carrying the application's own credentials to another host.
///
/// Authentication is app-only under <c>Sites.Selected</c>, using the same
/// <see cref="ITokenAcquisition"/> the Graph services already use.
/// </summary>
public class SharePointClient
{
    private readonly HttpClient _httpClient;
    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly ILogger<SharePointClient> _logger;
    private readonly Uri _siteUri;
    private readonly string _scope;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public SharePointClient(
        HttpClient httpClient,
        ITokenAcquisition tokenAcquisition,
        IOptions<SharePointSettings> settings,
        ILogger<SharePointClient> logger)
    {
        _httpClient = httpClient;
        _tokenAcquisition = tokenAcquisition;
        _logger = logger;
        _siteUri = settings.Value.ResolveSiteUri();

        // App-only tokens for SharePoint are issued per tenant host, not for a Graph scope.
        _scope = $"{_siteUri.Scheme}://{_siteUri.Host}/.default";
    }

    /// <summary>Site-relative REST root, for example <c>https://contoso.sharepoint.com/sites/rpp/_api</c>.</summary>
    public Uri SiteUri => _siteUri;

    /// <summary>
    /// Issues a GET against a site-relative REST path and deserialises the response.
    /// </summary>
    /// <param name="relativePath">
    /// Path beneath the site, starting with <c>/_api/</c>. Absolute URLs are rejected.
    /// </param>
    public async Task<T?> GetAsync<T>(string relativePath, CancellationToken cancellationToken = default)
    {
        var requestUri = BuildUri(relativePath);

        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        return await SendAsync<T>(request, cancellationToken);
    }

    /// <summary>
    /// Follows an <c>@odata.nextLink</c> returned by a previous page.
    ///
    /// The link is server-supplied but arrives back through a client-held page token, so it is
    /// validated against the configured site like any other input rather than trusted for having
    /// come from SharePoint once.
    /// </summary>
    public async Task<T?> GetAbsoluteAsync<T>(string absoluteUrl, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(absoluteUrl, UriKind.Absolute, out var uri) || !IsWithinConfiguredSite(uri))
        {
            throw new SharePointRequestException(
                $"Refused a SharePoint request to '{absoluteUrl}': outside the configured site '{_siteUri}'.",
                HttpStatusCode.BadRequest);
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        return await SendAsync<T>(request, cancellationToken);
    }

    private Uri BuildUri(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || !relativePath.StartsWith("/_api/", StringComparison.Ordinal))
        {
            throw new SharePointRequestException(
                $"SharePoint request path must be site-relative and start with '/_api/'. Received: '{relativePath}'.",
                HttpStatusCode.BadRequest);
        }

        var candidate = new Uri(_siteUri + relativePath, UriKind.Absolute);

        if (!IsWithinConfiguredSite(candidate))
        {
            throw new SharePointRequestException(
                $"Refused a SharePoint request to '{candidate}': outside the configured site '{_siteUri}'.",
                HttpStatusCode.BadRequest);
        }

        return candidate;
    }

    /// <summary>
    /// Host and site path must both match. Comparing the host alone would let a path escape into
    /// another site collection in the same tenant, which <c>Sites.Selected</c> is meant to prevent.
    /// </summary>
    private bool IsWithinConfiguredSite(Uri candidate)
    {
        if (candidate.Scheme != Uri.UriSchemeHttps ||
            !string.Equals(candidate.Host, _siteUri.Host, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var sitePath = _siteUri.AbsolutePath.TrimEnd('/');

        return candidate.AbsolutePath.StartsWith(sitePath + "/", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(candidate.AbsolutePath.TrimEnd('/'), sitePath, StringComparison.OrdinalIgnoreCase);
    }

    private async Task<T?> SendAsync<T>(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var token = await _tokenAcquisition.GetAccessTokenForAppAsync(_scope);

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("odata-version", "4.0");

        using var response = await _httpClient.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Throttling is its own condition (FR-430.7) and is retried in stage 3. Naming it here
            // already keeps it out of the generic failure bucket in logs from the first stage on.
            if (response.StatusCode == HttpStatusCode.TooManyRequests ||
                response.StatusCode == HttpStatusCode.ServiceUnavailable)
            {
                _logger.LogWarning(
                    "SharePoint throttled a request to {Path} with {StatusCode}. Retry-After: {RetryAfter}.",
                    request.RequestUri?.AbsolutePath,
                    (int)response.StatusCode,
                    response.Headers.RetryAfter?.ToString() ?? "none");
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            throw new SharePointRequestException(
                $"SharePoint request to '{request.RequestUri?.AbsolutePath}' failed with {(int)response.StatusCode}: {Truncate(body)}",
                response.StatusCode);
        }

        var stream = await response.Content.ReadAsStreamAsync(cancellationToken);

        return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken);
    }

    /// <summary>
    /// SharePoint error bodies can carry list content. The message reaches logs, so it is cut to a
    /// diagnostic length rather than logged whole (see the redaction rule in AGENTS.md).
    /// </summary>
    private static string Truncate(string body) =>
        string.IsNullOrEmpty(body) ? "(empty)" :
        body.Length <= 512 ? body : body[..512] + "…";
}

/// <summary>
/// EO-430: a SharePoint call that did not succeed. Carries the status code so callers can tell a
/// throttle or a permission failure from a mapping problem instead of inspecting message text.
/// </summary>
public class SharePointRequestException : Exception
{
    public SharePointRequestException(string message, HttpStatusCode statusCode)
        : base(message)
    {
        StatusCode = statusCode;
    }

    public HttpStatusCode StatusCode { get; }
}
