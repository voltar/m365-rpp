namespace RppWebApi.Services;

/// <summary>
/// EO-430: configuration for the SharePoint persistence profile (ADR-002).
///
/// One configured site per installation — there is no multi-site or multi-tenant list routing
/// (Non-Goals). The API reaches the lists with its own application identity under
/// <c>Sites.Selected</c>, scoped to this one site; authorization stays in the controllers exactly as
/// in the SQL profile, because the app identity is a store credential and not a permission model.
/// </summary>
public class SharePointSettings
{
    public const string SectionName = "SharePoint";

    /// <summary>
    /// Absolute URL of the site holding the planning lists, for example
    /// <c>https://contoso.sharepoint.com/sites/rpp</c>. Deployment configuration; no tenant-specific
    /// default belongs in committed files (BR-200.x).
    /// </summary>
    public string SiteUrl { get; set; } = string.Empty;

    /// <summary>
    /// EO-430 delivery stages 1–3: allows the API to start on an incomplete SharePoint provider.
    ///
    /// The provider is delivered in stages, and every stage before the last one can read more than
    /// it can write. Without this switch there is no way to exercise a half-built provider against a
    /// real site; with it defaulting to <c>false</c>, no deployment can come up on one by accident.
    /// Every start under this switch logs a warning naming what is missing. Removed in stage 4.
    /// </summary>
    public bool AllowIncompleteProvider { get; set; }

    /// <summary>
    /// The site origin, used to restrict outbound calls (<c>https://contoso.sharepoint.com</c>).
    /// </summary>
    /// <exception cref="SharePointConfigurationException">The configured URL is missing or unusable.</exception>
    public Uri ResolveSiteUri()
    {
        if (string.IsNullOrWhiteSpace(SiteUrl))
        {
            throw new SharePointConfigurationException(
                $"No SharePoint site configured. Set '{SectionName}:SiteUrl' to the absolute URL of the site holding the planning lists.");
        }

        if (!Uri.TryCreate(SiteUrl.TrimEnd('/'), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new SharePointConfigurationException(
                $"'{SectionName}:SiteUrl' must be an absolute https URL. Configured value: '{SiteUrl}'.");
        }

        return uri;
    }
}

/// <summary>
/// EO-430: raised at startup when the SharePoint profile is selected but not usably configured.
/// Named so the failure is identifiable in logs rather than surfacing as a generic startup error,
/// matching <see cref="PlanningStoreConfigurationException"/>.
/// </summary>
public class SharePointConfigurationException : Exception
{
    public SharePointConfigurationException(string message)
        : base(message)
    {
    }
}
