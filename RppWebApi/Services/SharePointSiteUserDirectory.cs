using System.Text.Json.Serialization;

namespace RppWebApi.Services;

/// <summary>
/// EO-430 FR-430.12: person-valued facts are stored as SharePoint <c>User</c> columns, which hold a
/// site-collection lookup id — not the Microsoft Graph user id the domain model works in.
///
/// The Graph id is one hop away: a site user carries <c>UserId.NameId</c> (issuer
/// <c>urn:federation:microsoftonline</c>), which is the Entra object id. This directory makes that
/// hop once per site instead of once per row, and serves both directions, because a person column
/// cannot be filtered by Graph id either — an employee-scoped query resolves first, then filters
/// (FR-430.7). One cache serves both.
/// </summary>
public class SharePointSiteUserDirectory
{
    /// <summary>
    /// Only this issuer means the value is an Entra object id. Other issuers exist — on-premises
    /// federation and the SharePoint system accounts, for two — and their identifiers are something
    /// else entirely.
    /// </summary>
    private const string EntraNameIdIssuer = "urn:federation:microsoftonline";

    /// <summary>SharePoint principal type for a user (as opposed to a security or SharePoint group).</summary>
    private const int UserPrincipalType = 1;

    /// <summary>
    /// <c>AadObjectId</c>, not <c>UserId</c>. Verified against a live tenant on 2026-07-31:
    /// <c>UserId.NameId</c> under this same issuer returned a 16-hex Microsoft Account PUID for
    /// members (<c>1003bffd895733a1</c>) and nothing at all for guests. It is not the Entra object
    /// id, and the issuer check does not protect against that — the issuer was correct and the value
    /// was still wrong. <c>AadObjectId.NameId</c> carries the object id for members and guests alike.
    /// </summary>
    private const string SiteUsersPath =
        "/_api/web/siteusers?$select=Id,Title,PrincipalType,AadObjectId&$top=500";

    // Site membership changes rarely and every planning read needs it. Cached across requests, with
    // a window short enough that a newly added person appears without a restart.
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(15);
    private static readonly SemaphoreSlim CacheLock = new(1, 1);
    private static SiteUserIndex? _cached;
    private static DateTimeOffset _cachedAt;

    private readonly SharePointClient _client;
    private readonly ILogger<SharePointSiteUserDirectory> _logger;

    public SharePointSiteUserDirectory(SharePointClient client, ILogger<SharePointSiteUserDirectory> logger)
    {
        _client = client;
        _logger = logger;
    }

    /// <summary>Graph user id for a person column value, or null when it cannot be resolved.</summary>
    public async Task<string?> ResolveGraphUserIdAsync(int? lookupId, CancellationToken cancellationToken = default)
    {
        if (lookupId is null)
        {
            return null;
        }

        var index = await LoadAsync(cancellationToken);

        return index.GraphIdByLookupId.GetValueOrDefault(lookupId.Value);
    }

    /// <summary>Site lookup id for a Graph user id, or null when the person is unknown to the site.</summary>
    public async Task<int?> ResolveLookupIdAsync(string? graphUserId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(graphUserId))
        {
            return null;
        }

        var index = await LoadAsync(cancellationToken);

        return index.LookupIdByGraphId.TryGetValue(graphUserId.ToLowerInvariant(), out var lookupId)
            ? lookupId
            : null;
    }

    /// <summary>Display name SharePoint renders for a person column value.</summary>
    public async Task<string?> ResolveDisplayNameAsync(int? lookupId, CancellationToken cancellationToken = default)
    {
        if (lookupId is null)
        {
            return null;
        }

        var index = await LoadAsync(cancellationToken);

        return index.DisplayNameByLookupId.GetValueOrDefault(lookupId.Value);
    }

    /// <summary>Drops the cache. Used after a write that added a person to the site.</summary>
    public static void Invalidate()
    {
        _cached = null;
    }

    private async Task<SiteUserIndex> LoadAsync(CancellationToken cancellationToken)
    {
        if (_cached is not null && DateTimeOffset.UtcNow - _cachedAt < CacheDuration)
        {
            return _cached;
        }

        await CacheLock.WaitAsync(cancellationToken);

        try
        {
            // Re-checked under the lock: several planning reads open at once, and without this they
            // would each fetch the directory the first one is already fetching.
            if (_cached is not null && DateTimeOffset.UtcNow - _cachedAt < CacheDuration)
            {
                return _cached;
            }

            _cached = await FetchIndexAsync(cancellationToken);
            _cachedAt = DateTimeOffset.UtcNow;

            return _cached;
        }
        finally
        {
            CacheLock.Release();
        }
    }

    private async Task<SiteUserIndex> FetchIndexAsync(CancellationToken cancellationToken)
    {
        var graphIdByLookupId = new Dictionary<int, string>();
        var lookupIdByGraphId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var displayNameByLookupId = new Dictionary<int, string>();

        try
        {
            var page = await _client.GetAsync<SiteUserResponse>(SiteUsersPath, cancellationToken);

            while (page is not null)
            {
                foreach (var siteUser in page.Value ?? [])
                {
                    if (siteUser.Id is not { } id)
                    {
                        continue;
                    }

                    if (!string.IsNullOrWhiteSpace(siteUser.Title))
                    {
                        displayNameByLookupId[id] = siteUser.Title;
                    }

                    // Groups carry an object id too — the two default SharePoint groups both report
                    // the owning M365 group's id, so mapping them would make one Graph id resolve
                    // back to whichever lookup id came last. Only users are people.
                    if (siteUser.PrincipalType != UserPrincipalType)
                    {
                        continue;
                    }

                    var objectId = siteUser.AadObjectId?.NameId;

                    if (string.IsNullOrWhiteSpace(objectId) ||
                        !string.Equals(siteUser.AadObjectId?.NameIdIssuer, EntraNameIdIssuer, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    // A Graph object id is a GUID. Checking the shape is what would have caught the
                    // PUID this code used to read: the issuer was right, the field was wrong, and
                    // every absence was silently attached to an id no Graph lookup can resolve.
                    if (!Guid.TryParse(objectId, out _))
                    {
                        _logger.LogWarning(
                            "Site user {LookupId} reports an Entra object id that is not a GUID. Ignored — it cannot address a Graph user.",
                            id);

                        continue;
                    }

                    graphIdByLookupId[id] = objectId;
                    lookupIdByGraphId[objectId] = id;
                }

                if (string.IsNullOrWhiteSpace(page.NextLink))
                {
                    break;
                }

                page = await _client.GetAbsoluteAsync<SiteUserResponse>(page.NextLink, cancellationToken);
            }
        }
        catch (SharePointRequestException exception)
        {
            // A directory that cannot be read must not fail every planning query. Rows then carry no
            // employee id and are returned as unlinkable — the same outcome as a single unresolvable
            // person, which callers already handle. Logged as its own condition, because silently
            // unlinking every row would otherwise look like an empty tenant.
            _logger.LogError(
                exception,
                "SharePoint site user directory could not be read. Person columns resolve to no employee id until it recovers.");

            return SiteUserIndex.Empty;
        }

        _logger.LogInformation(
            "SharePoint site user directory loaded: {ResolvedCount} of {TotalCount} site users carry an Entra object id.",
            graphIdByLookupId.Count,
            displayNameByLookupId.Count);

        return new SiteUserIndex(graphIdByLookupId, lookupIdByGraphId, displayNameByLookupId);
    }

    private sealed record SiteUserIndex(
        IReadOnlyDictionary<int, string> GraphIdByLookupId,
        IReadOnlyDictionary<string, int> LookupIdByGraphId,
        IReadOnlyDictionary<int, string> DisplayNameByLookupId)
    {
        public static SiteUserIndex Empty { get; } = new(
            new Dictionary<int, string>(),
            new Dictionary<string, int>(),
            new Dictionary<int, string>());
    }

    private sealed class SiteUserResponse
    {
        public List<SiteUser>? Value { get; set; }

        [JsonPropertyName("@odata.nextLink")]
        public string? NextLink { get; set; }
    }

    private sealed class SiteUser
    {
        public int? Id { get; set; }
        public string? Title { get; set; }
        public int PrincipalType { get; set; }
        public SiteUserNameId? AadObjectId { get; set; }
    }

    private sealed class SiteUserNameId
    {
        public string? NameId { get; set; }
        public string? NameIdIssuer { get; set; }
    }
}
