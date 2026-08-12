using Microsoft.Extensions.Options;
using Microsoft.Graph;
using Microsoft.Identity.Web;
using RppWebApi.Models;
using Microsoft.Kiota.Abstractions;
using Microsoft.Kiota.Abstractions.Authentication;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace RppWebApi.Services;

/// <summary>
/// Real Graph service to fetch live team members from Microsoft 365 (EO-406).
/// Uses the already configured ITokenAcquisition from Microsoft.Identity.Web.
/// </summary>
public class GraphTeamMembershipService
{
    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly ILogger<GraphTeamMembershipService> _logger;
    private readonly string[] _graphScopes = ["https://graph.microsoft.com/.default"];

    // Short-lived cache: Team Admin details + planning memberships both need the member list,
    // and Graph round-trips are the slowest part of those requests.
    // EO-419: keyed per team id so multi-team host contexts never leak each other's members.
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);
    private static readonly SemaphoreSlim CacheLock = new(1, 1);
    private static readonly Dictionary<string, (List<TeamMembershipDto> Members, DateTimeOffset Timestamp)> MemberCache = new(StringComparer.OrdinalIgnoreCase);
    private const string DefaultCacheKey = "__default";

    private readonly GraphSettings _graphSettings;

    public GraphTeamMembershipService(
        ITokenAcquisition tokenAcquisition,
        IOptions<GraphSettings> graphSettings,
        ILogger<GraphTeamMembershipService> logger)
    {
        _tokenAcquisition = tokenAcquisition;
        _graphSettings = graphSettings.Value;
        _logger = logger;
    }

    /// <summary>
    /// Returns real members from Microsoft Graph for the given team (or fallback team).
    /// </summary>
    public virtual async Task<List<TeamMembershipDto>> GetRealTeamMembersAsync(string? teamId = null, bool throwOnFailure = false)
    {
        var cacheKey = string.IsNullOrWhiteSpace(teamId) ? DefaultCacheKey : teamId;

        if (TryGetCached(cacheKey, out var cachedMembers))
        {
            return cachedMembers;
        }

        await CacheLock.WaitAsync();

        try
        {
            if (TryGetCached(cacheKey, out cachedMembers))
            {
                return cachedMembers;
            }

            List<TeamMembershipDto> members;

            try
            {
                members = await FetchTeamMembersAsync(teamId);
            }
            catch (GraphUnavailableException) when (!throwOnFailure)
            {
                // Best-effort callers - seeding, display names, enrichment - kept working through a
                // Graph outage before and still do. Only callers that ask for it get the failure.
                return new List<TeamMembershipDto>();
            }

            if (members.Count > 0)
            {
                MemberCache[cacheKey] = (members, DateTimeOffset.UtcNow);
            }

            return members;
        }
        finally
        {
            CacheLock.Release();
        }
    }

    private static bool TryGetCached(string cacheKey, out List<TeamMembershipDto> members)
    {
        if (MemberCache.TryGetValue(cacheKey, out var entry) && DateTimeOffset.UtcNow - entry.Timestamp < CacheDuration)
        {
            members = entry.Members;
            return true;
        }

        members = new List<TeamMembershipDto>();
        return false;
    }

    /// <summary>
    /// EO-418: verifies whether the given user is an owner of the specified M365 Team.
    /// </summary>
    public virtual async Task<bool> IsUserOwnerOfTeamAsync(string userId, string? teamId = null)
    {
        if (string.IsNullOrWhiteSpace(userId))
        {
            return false;
        }

        var members = await GetRealTeamMembersAsync(teamId);

        return members.Any(member =>
            string.Equals(member.Member.Id, userId, StringComparison.OrdinalIgnoreCase)
            && member.Member.IsOwner);
    }

    private async Task<List<TeamMembershipDto>> FetchTeamMembersAsync(string? teamId)
    {
        var targetTeamId = teamId ?? _graphSettings.TeamGroupId;

        if (string.IsNullOrWhiteSpace(targetTeamId))
        {
            _logger.LogError("No Graph team group id is configured. Set Graph:TeamGroupId in the configuration (EO-407).");
            return new List<TeamMembershipDto>();
        }

        try
        {

            _logger.LogInformation("Fetching real M365 members via Graph for group {GroupId} using Application token", targetTeamId);

            var graphClient = await CreateGraphClientAsync();

            // EO-428: both collections are paged. Reading only the first page silently truncated
            // every team above the Graph page size, and the effect looked like a permission
            // problem: owners come from the separate /owners call and are few, so they were always
            // on page one, while a member or guest further down simply did not exist for the
            // membership gate and was refused.
            var members = await ReadAllUsersAsync(
                () => graphClient.Groups[targetTeamId].Members.GetAsync(req =>
                {
                    req.QueryParameters.Select = MemberSelectFields;
                    req.QueryParameters.Top = 999;
                }),
                nextLink => new Microsoft.Graph.Groups.Item.Members.MembersRequestBuilder(
                    nextLink, graphClient.RequestAdapter).GetAsync());

            var owners = await ReadAllUsersAsync(
                () => graphClient.Groups[targetTeamId].Owners.GetAsync(req =>
                {
                    req.QueryParameters.Select = MemberSelectFields;
                    req.QueryParameters.Top = 999;
                }),
                nextLink => new Microsoft.Graph.Groups.Item.Owners.OwnersRequestBuilder(
                    nextLink, graphClient.RequestAdapter).GetAsync());

            var ownerIds = owners
                .Select(user => user.Id)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Select(id => id!)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var allUsers = members
                .Concat(owners)
                .Where(user => !string.IsNullOrWhiteSpace(user.Id))
                .GroupBy(user => user.Id!, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToList();

            // EO-415: /groups/{id}/members accepts companyName/officeLocation in $select but often
            // returns them empty. The user resource is the reliable source (User.Read.All).
            await EnrichCompanyAndLocationAsync(graphClient, allUsers);

            var result = new List<TeamMembershipDto>();

            foreach (var user in allUsers)
            {
                string displayName = user.DisplayName ?? user.UserPrincipalName ?? "Unknown User";
                string email = user.Mail ?? user.UserPrincipalName ?? "";
                var companyName = NormalizeProfileValue(user.CompanyName);
                var officeLocation = NormalizeProfileValue(user.OfficeLocation);

                _logger.LogDebug(
                    "Graph User: Id={Id}, DisplayName={DisplayName}, Mail={Mail}, Company={Company}, Office={Office}",
                    user.Id, user.DisplayName, user.Mail, companyName, officeLocation);

                result.Add(new TeamMembershipDto
                {
                    Id = $"mship-{Guid.NewGuid().ToString("N").Substring(0, 8)}",
                    Member = new TeamMemberDto
                    {
                        Id = user.Id ?? "",
                        DisplayName = displayName,
                        Mail = email,
                        Initials = CreateInitials(displayName),
                        // EO-415: raw Graph profile values; the repository resolves them
                        // through the configured ProfileValueMappings. Until then the raw
                        // values are also the display defaults so the UI is never blank when
                        // Graph has data and no mapping exists yet.
                        RawOrganizationValue = companyName,
                        RawLocationValue = officeLocation,
                        Organization = companyName ?? string.Empty,
                        Location = officeLocation ?? string.Empty,
                        IsGuest = user.UserType?.Equals("Guest", StringComparison.OrdinalIgnoreCase) == true,
                        IsOwner = !string.IsNullOrWhiteSpace(user.Id) && ownerIds.Contains(user.Id)
                    },
                    TeamId = targetTeamId,
                    TeamName = _graphSettings.TeamName,
                    IsPrimary = true
                });
            }

            var withCompany = result.Count(m => !string.IsNullOrWhiteSpace(m.Member.RawOrganizationValue));
            var withLocation = result.Count(m => !string.IsNullOrWhiteSpace(m.Member.RawLocationValue));
            _logger.LogInformation(
                "Successfully loaded {Count} real members+owners from Microsoft Graph for RPP group (company={CompanyCount}, location={LocationCount})",
                result.Count, withCompany, withLocation);
            return result;
        }
        catch (Exception ex)
        {
            // EO-428: the previous message said it out loud — "no members OR insufficient
            // permissions" — and then returned the same empty list for both. The caller could not
            // tell an outage from an empty team, so a permission problem reached the user as
            // "no plannable people found". The failure is now carried, and best-effort callers
            // decide for themselves whether to ignore it.
            _logger.LogError(ex, "Failed to fetch members from Microsoft Graph for group {GroupId}.", targetTeamId);
            throw new GraphUnavailableException($"Microsoft Graph did not answer for group {targetTeamId}.", ex);
        }
    }

    private async Task<GraphServiceClient> CreateGraphClientAsync()
    {
        // Use GetAccessTokenForAppAsync because we have Application permissions (GroupMember.Read.All)
        // This is more reliable for background/server-side calls without a user context.
        var accessToken = await _tokenAcquisition.GetAccessTokenForAppAsync("https://graph.microsoft.com/.default");

        _logger.LogInformation("Successfully acquired Graph access token for app (length: {Length})", accessToken?.Length ?? 0);

        var tokenProvider = new TokenProvider(accessToken ?? "");
        return new GraphServiceClient(tokenProvider);
    }

    private class TokenProvider : IAuthenticationProvider
    {
        private readonly string _token;

        public TokenProvider(string token)
        {
            _token = token;
        }

        public Task AuthenticateRequestAsync(RequestInformation request, Dictionary<string, object>? additionalAuthenticationContext = null, CancellationToken cancellationToken = default)
        {
            request.Headers.Add("Authorization", $"Bearer {_token}");
            return Task.CompletedTask;
        }
    }

    private static string CreateInitials(string name)
    {
        var parts = name.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "??";
        return string.Join("", parts.Take(2).Select(p => p[0])).ToUpperInvariant();
    }

    /// <summary>
    /// EO-415: clears the member cache so mapping changes become visible immediately.
    /// </summary>
    public static void InvalidateCache()
    {
        MemberCache.Clear();
    }

    // EO-418: display name of the M365 group/team for the header badge (cached).
    private static readonly Dictionary<string, string> TeamNameCache = new(StringComparer.OrdinalIgnoreCase);

    public virtual async Task<string?> GetTeamDisplayNameAsync(string? teamId)
    {
        var targetTeamId = string.IsNullOrWhiteSpace(teamId) ? _graphSettings.TeamGroupId : teamId;

        if (string.IsNullOrWhiteSpace(targetTeamId))
        {
            return null;
        }

        if (TeamNameCache.TryGetValue(targetTeamId, out var cachedName))
        {
            return cachedName;
        }

        try
        {
            var graphClient = await CreateGraphClientAsync();
            var group = await graphClient.Groups[targetTeamId]
                .GetAsync(req => req.QueryParameters.Select = new[] { "displayName" });
            var displayName = group?.DisplayName;

            if (!string.IsNullOrWhiteSpace(displayName))
            {
                TeamNameCache[targetTeamId] = displayName;
            }

            return displayName;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not resolve display name for team {TeamId}.", targetTeamId);
            return null;
        }
    }

    /// <summary>
    /// EO-428 FR-428.2: the Microsoft 365 teams the given user actually belongs to.
    ///
    /// Needed because the personal app scope carries no host context, and the answer to "which team
    /// do you mean" must come from the caller's real memberships rather than from a configured
    /// constant. Reads /users/{id}/memberOf and keeps the groups that are Teams — the same
    /// application permission that already backs the member reads (GroupMember.Read.All).
    /// </summary>
    public virtual async Task<List<UserTeamDto>> GetTeamsForUserAsync(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId))
        {
            return new List<UserTeamDto>();
        }

        try
        {
            var graphClient = await CreateGraphClientAsync();
            var membership = await graphClient.Users[userId]
                .MemberOf
                .GetAsync(req =>
                {
                    req.QueryParameters.Select = new[] { "id", "displayName", "resourceProvisioningOptions" };
                    req.QueryParameters.Top = 100;
                });

            var teams = (membership?.Value ?? new List<Microsoft.Graph.Models.DirectoryObject>())
                .OfType<Microsoft.Graph.Models.Group>()
                // A Microsoft 365 group is only a Team when it was provisioned as one. Without this
                // the picker would offer distribution lists and security groups as "teams".
                .Where(group => group.AdditionalData is not null
                    && group.AdditionalData.TryGetValue("resourceProvisioningOptions", out var options)
                    && options?.ToString()?.Contains("Team", StringComparison.OrdinalIgnoreCase) == true)
                .Where(group => !string.IsNullOrWhiteSpace(group.Id))
                .Select(group => new UserTeamDto
                {
                    TeamId = group.Id!,
                    TeamName = group.DisplayName ?? group.Id!
                })
                .OrderBy(team => team.TeamName, StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            _logger.LogInformation("Resolved {Count} Microsoft 365 teams for user {UserId}.", teams.Count, userId);

            return teams;
        }
        catch (Exception ex)
        {
            // Deliberately not an empty list dressed as success: the caller distinguishes "you are
            // in no teams" from "we could not ask", because only the second is worth retrying.
            _logger.LogError(ex, "Could not resolve Microsoft 365 teams for user {UserId}.", userId);
            throw;
        }
    }

    private static readonly string[] MemberSelectFields =
        { "id", "displayName", "mail", "userPrincipalName", "userType", "companyName", "officeLocation" };

    private static readonly string[] ProfileSelectFields =
        { "id", "companyName", "officeLocation" };

    /// <summary>
    /// EO-415: company (Firma) and office location (Standort) must come from the user profile.
    /// The group members collection frequently omits both even when $select names them; reading
    /// /users/{id} under User.Read.All is the reliable path. Bounded parallelism keeps a cache
    /// miss on a large team from serialising hundreds of Graph round-trips.
    /// </summary>
    private async Task EnrichCompanyAndLocationAsync(
        GraphServiceClient graphClient,
        IReadOnlyList<Microsoft.Graph.Models.User> users)
    {
        var missingProfile = users
            .Where(user => !string.IsNullOrWhiteSpace(user.Id))
            .Where(user =>
                string.IsNullOrWhiteSpace(user.CompanyName) ||
                string.IsNullOrWhiteSpace(user.OfficeLocation))
            .ToList();

        if (missingProfile.Count == 0)
        {
            return;
        }

        var enriched = 0;
        await Parallel.ForEachAsync(
            missingProfile,
            new ParallelOptions { MaxDegreeOfParallelism = 8 },
            async (user, cancellationToken) =>
            {
                try
                {
                    var profile = await graphClient.Users[user.Id!].GetAsync(req =>
                    {
                        req.QueryParameters.Select = ProfileSelectFields;
                    }, cancellationToken);

                    if (profile is null)
                    {
                        return;
                    }

                    if (string.IsNullOrWhiteSpace(user.CompanyName) && !string.IsNullOrWhiteSpace(profile.CompanyName))
                    {
                        user.CompanyName = profile.CompanyName;
                    }

                    if (string.IsNullOrWhiteSpace(user.OfficeLocation) && !string.IsNullOrWhiteSpace(profile.OfficeLocation))
                    {
                        user.OfficeLocation = profile.OfficeLocation;
                    }

                    Interlocked.Increment(ref enriched);
                }
                catch (Exception ex)
                {
                    // One missing profile must not fail the whole membership list — the person
                    // stays plannable, only company/location stay empty for that row.
                    _logger.LogDebug(ex, "Could not read company/office profile for user {UserId}.", user.Id);
                }
            });

        _logger.LogInformation(
            "Graph profile enrichment for company/office: attempted={Attempted}, answered={Enriched}.",
            missingProfile.Count,
            enriched);
    }

    private static string? NormalizeProfileValue(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    /// <summary>
    /// EO-428: reads every page of a Graph collection, not just the first.
    ///
    /// Graph returns group members in pages and hands back an @odata.nextLink for the rest. Stopping
    /// at page one truncated the membership list without any error, which the caller then read as
    /// "this person is not a member" - a silent wrong answer rather than a visible failure.
    /// </summary>
    private static async Task<List<Microsoft.Graph.Models.User>> ReadAllUsersAsync(
        Func<Task<Microsoft.Graph.Models.DirectoryObjectCollectionResponse?>> readFirstPage,
        Func<string, Task<Microsoft.Graph.Models.DirectoryObjectCollectionResponse?>> readNextPage)
    {
        var users = new List<Microsoft.Graph.Models.User>();
        var page = await readFirstPage();

        // A cycle would otherwise hang the request; Graph does not produce one, but a bounded loop
        // costs nothing and a hung membership check would look like an outage.
        for (var guard = 0; page is not null && guard < 100; guard++)
        {
            if (page.Value is not null)
            {
                users.AddRange(page.Value.OfType<Microsoft.Graph.Models.User>());
            }

            if (string.IsNullOrWhiteSpace(page.OdataNextLink))
            {
                break;
            }

            page = await readNextPage(page.OdataNextLink);
        }

        return users;
    }
}
