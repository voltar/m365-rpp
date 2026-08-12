using Microsoft.Identity.Web;
using System.Collections.Concurrent;
using System.Net.Http.Headers;

namespace RppWebApi.Services;

/// <summary>
/// EO-421: serves Microsoft 365 profile photos to the SPA. The browser holds no
/// Graph token with the api data source, so the API proxies the photo read with
/// its application permissions. Results (including "no photo") are cached so a
/// timeline with ~30 resources does not hammer Graph on every load.
/// </summary>
public class UserPhotoService
{
    private const string GraphBaseUrl = "https://graph.microsoft.com/v1.0";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromHours(24);
    private static readonly ConcurrentDictionary<string, CachedPhoto> Cache = new();

    private readonly HttpClient _httpClient;
    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly ILogger<UserPhotoService> _logger;

    private sealed record CachedPhoto(byte[]? Bytes, string? ContentType, DateTime CachedAtUtc);

    public UserPhotoService(HttpClient httpClient, ITokenAcquisition tokenAcquisition, ILogger<UserPhotoService> logger)
    {
        _httpClient = httpClient;
        _tokenAcquisition = tokenAcquisition;
        _logger = logger;
    }

    /// <summary>Returns the photo bytes and content type, or null when the user has no photo.</summary>
    public async Task<(byte[] Bytes, string ContentType)?> GetUserPhotoAsync(string userId, CancellationToken cancellationToken)
    {
        if (Cache.TryGetValue(userId, out var cached) && DateTime.UtcNow - cached.CachedAtUtc < CacheDuration)
        {
            return cached.Bytes is null ? null : (cached.Bytes, cached.ContentType ?? "image/jpeg");
        }

        try
        {
            // 64x64 size class: crisp at the 32px timeline avatar on high-DPI displays.
            var token = await _tokenAcquisition.GetAccessTokenForAppAsync("https://graph.microsoft.com/.default");
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"{GraphBaseUrl}/users/{Uri.EscapeDataString(userId)}/photos/64x64/$value");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var response = await _httpClient.SendAsync(request, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                // Missing photo is the normal case for many accounts - negative-cache it.
                Cache[userId] = new CachedPhoto(null, null, DateTime.UtcNow);
                return null;
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            Cache[userId] = new CachedPhoto(bytes, contentType, DateTime.UtcNow);
            return (bytes, contentType);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(exception, "Profile photo lookup failed for user {UserId}.", userId);
            return null;
        }
    }
}
