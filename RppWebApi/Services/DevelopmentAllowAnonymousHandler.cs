using Microsoft.AspNetCore.Authorization;

namespace RppWebApi.Services;

/// <summary>
/// Succeeds every authorization requirement. Registered ONLY when
/// ApiSettings:RequireAuthentication is false (local development without Teams SSO).
/// Never register this handler in production (EO-405).
/// </summary>
public class DevelopmentAllowAnonymousHandler : IAuthorizationHandler
{
    public Task HandleAsync(AuthorizationHandlerContext context)
    {
        foreach (var requirement in context.PendingRequirements.ToList())
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
