using System.Security.Claims;
using RppWebApi.Models;

namespace RppWebApi.Services;

/// <summary>
/// EO-418/419: the app-admin check, shared by every controller that guards a
/// tenant-wide administrative action.
///
/// Extracted from PlanningController in EO-424 so MailboxSyncController enforces exactly the
/// same rule rather than a second, drifting copy.
/// </summary>
public static class AppAdminAuthorization
{
    public static string? GetUserObjectId(ClaimsPrincipal user)
    {
        return user.FindFirstValue("oid")
            ?? user.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
            ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? user.FindFirstValue("sub");
    }

    /// <summary>
    /// True when the caller holds an app-admin directory role, or when no user identity is
    /// present at all - the local development bypass (ApiSettings:RequireAuthentication=false).
    /// </summary>
    public static bool IsAppAdminOrDevBypass(ClaimsPrincipal user, AppAdminSettings settings)
    {
        return string.IsNullOrWhiteSpace(GetUserObjectId(user)) || HasAppAdminRole(user, settings);
    }

    public static bool HasAppAdminRole(ClaimsPrincipal user, AppAdminSettings settings)
    {
        // Explicit admin user list (tenant onboarding / tokens without a wids claim).
        var currentUserId = GetUserObjectId(user);

        if (!string.IsNullOrWhiteSpace(currentUserId)
            && settings.AllowedAdminUserIds.Contains(currentUserId, StringComparer.OrdinalIgnoreCase))
        {
            return true;
        }

        // wids carries the caller's Entra directory role template ids. PIM-eligible roles must
        // be activated to appear here.
        return user.Claims
            .Where(claim => string.Equals(claim.Type, "wids", StringComparison.OrdinalIgnoreCase))
            .Any(claim => settings.AllowedRoleTemplateIds.Contains(claim.Value, StringComparer.OrdinalIgnoreCase));
    }
}
