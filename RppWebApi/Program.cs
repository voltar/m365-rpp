using Microsoft.Identity.Web;
using RppWebApi.Controllers;
using RppWebApi.Data;
using RppWebApi.Models;
using RppWebApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Graph;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "RPP Web API", Version = "v1" });
});

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes =
    [
        "text/html",
        "text/css",
        "application/javascript",
        "text/javascript",
        "image/svg+xml",
        "application/wasm"
    ];
});
builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
    options.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(options =>
    options.Level = CompressionLevel.Fastest);

// Microsoft Entra ID / Teams SSO (full production setup for your tenant)
builder.Services.AddMicrosoftIdentityWebApiAuthentication(builder.Configuration, "AzureAd")
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddInMemoryTokenCaches();

// Teams SSO tokens carry the domain-form Application ID URI as audience
// (api://<app-domain>/<client-id>); older config used api://<client-id>. Accept all known forms
// so a stale AzureAd__Audience app setting cannot lock the API.
var azureAdClientId = builder.Configuration["AzureAd:ClientId"];
var configuredAudience = builder.Configuration["AzureAd:Audience"];
builder.Services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
{
    var validAudiences = new[]
    {
        configuredAudience,
        azureAdClientId,
        $"api://{azureAdClientId}",
        $"api://rpp-api.example.com/{azureAdClientId}"
    };

    options.TokenValidationParameters.ValidAudiences = validAudiences
        .Where(audience => !string.IsNullOrWhiteSpace(audience))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
});

// EO-430 FR-430.2: the persistence profile is deployment configuration (ADR-002), resolved here.
// An unknown or missing value stops startup — binding a store the operator did not choose is the
// failure mode this switch exists to prevent.
var planningStore = PlanningStoreSettings.Parse(
    builder.Configuration.GetSection(PlanningStoreSettings.SectionName)["Provider"]);

builder.Services.AddSingleton(new PlanningStoreSelection(planningStore));

switch (planningStore)
{
    case PlanningStoreProvider.Sql:
        // ADR-007 / EO-458: SQL Server remains the default relational engine (Azure SQL friendly).
        builder.Services.AddDbContext<RppDbContext>(options =>
            options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));
        builder.Services.AddScoped<IPlanningRepository, EfPlanningRepository>();
        break;

    case PlanningStoreProvider.Postgres:
        // ADR-007 / EO-458: same EfPlanningRepository, Npgsql engine for Linux / Host Europe / local.
        // JSON date-only values arrive as DateTimeKind.Unspecified. Without legacy behaviour
        // Npgsql rejects them for timestamptz (HTTP 500 on every absence/vacation write).
        // EfPlanningRepository also normalizes to UTC; this switch is the safety net.
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
        builder.Services.AddDbContext<RppDbContext>(options =>
            options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));
        builder.Services.AddScoped<IPlanningRepository, EfPlanningRepository>();
        break;

    case PlanningStoreProvider.Mock:
        builder.Services.AddScoped<IPlanningRepository, MockPlanningRepository>();
        break;

    case PlanningStoreProvider.SharePoint:
        // EO-430 delivery stage 1: the read path is complete, writes throw. An installation may
        // only come up on it deliberately — without the opt-in this stays a refusal, so no
        // deployment can believe it is SharePoint-backed while half the contract is missing.
        var sharePointSettings = builder.Configuration
            .GetSection(SharePointSettings.SectionName)
            .Get<SharePointSettings>() ?? new SharePointSettings();

        if (!sharePointSettings.AllowIncompleteProvider)
        {
            throw new PlanningStoreConfigurationException(
                "The 'sharepoint' planning store is delivered in stages and cannot write yet (EO-430, stage 1 of 4: " +
                "the read path is complete, writes are not). To run it against a site for verification, set " +
                $"'{SharePointSettings.SectionName}:AllowIncompleteProvider' to true. " +
                $"For a complete store use one of: {PlanningStoreSettings.SupportedValues}.");
        }

        // Fails startup here rather than on the first request if the site is not configured.
        sharePointSettings.ResolveSiteUri();

        builder.Services.Configure<SharePointSettings>(
            builder.Configuration.GetSection(SharePointSettings.SectionName));
        builder.Services.AddHttpClient<SharePointClient>().AddRppResilience();
        builder.Services.AddScoped<SharePointSiteUserDirectory>();
        builder.Services.AddScoped<IPlanningRepository, SharePointPlanningRepository>();
        break;
}

builder.Services.Configure<GraphSettings>(builder.Configuration.GetSection(GraphSettings.SectionName));
builder.Services.AddScoped<GraphTeamMembershipService>();
builder.Services.Configure<OutboundHttpResilienceSettings>(
    builder.Configuration.GetSection(OutboundHttpResilienceSettings.SectionName));
builder.Services.AddTransient<ResilientHttpMessageHandler>();

// EO-450: help assistant. The Foundry provider is only registered once the resource is
// configured; until then the fallback answers, so the Help tab degrades to a clear message
// instead of an error. No API key exists - authentication is Managed Identity only.
builder.Services.Configure<HelpAssistantSettings>(builder.Configuration.GetSection(HelpAssistantSettings.SectionName));

var helpAssistantSettings = builder.Configuration
    .GetSection(HelpAssistantSettings.SectionName)
    .Get<HelpAssistantSettings>() ?? new HelpAssistantSettings();

if (helpAssistantSettings.IsConfigured)
{
    builder.Services.AddHttpClient<IFoundryTokenProvider, ManagedIdentityFoundryTokenProvider>().AddRppResilience();
    builder.Services.AddHttpClient<IHelpAssistantService, FoundryHelpAssistantService>().AddRppResilience();
}
else
{
    builder.Services.AddSingleton<IHelpAssistantService, FallbackHelpAssistantService>();
}

// EO-410: server-side Power Automate approval flow call (flow URL + callback secret via user secrets / app settings)
builder.Services.Configure<ApprovalFlowSettings>(builder.Configuration.GetSection(ApprovalFlowSettings.SectionName));
builder.Services.AddHttpClient<ApprovalFlowService>().AddRppResilience();

// EO-410 (Graph provider): Microsoft Approvals directly via Graph beta (delegated OBO),
// no Power Automate / premium license required.
builder.Services.Configure<GraphApprovalSettings>(builder.Configuration.GetSection(GraphApprovalSettings.SectionName));
builder.Services.AddHttpClient<IGraphApprovalService, GraphApprovalService>().AddRppResilience();

// EO-414: one-way Outlook calendar sync (app-only Calendars.ReadWrite)
builder.Services.Configure<OutlookSyncSettings>(builder.Configuration.GetSection(OutlookSyncSettings.SectionName));
builder.Services.AddHttpClient<OutlookCalendarSyncService>().AddRppResilience();

// EO-424: inbound Outlook mailbox sync (app-only Mail.ReadWrite scoped to shared mailbox)
builder.Services.Configure<MailboxSyncSettings>(builder.Configuration.GetSection(MailboxSyncSettings.SectionName));
// EO-424: run state must outlive the transient typed-HttpClient service (see MailboxSyncState).
builder.Services.AddSingleton<MailboxSyncState>();
builder.Services.AddHttpClient<MailboxSyncService>().AddRppResilience();
builder.Services.AddHostedService<MailboxSyncBackgroundService>();

// EO-421: profile photo proxy (app-only Graph photo read)
builder.Services.AddHttpClient<UserPhotoService>().AddRppResilience();

// EO-418: App Admin access via Entra directory roles (wids claim)
builder.Services.Configure<AppAdminSettings>(builder.Configuration.GetSection(AppAdminSettings.SectionName));

// EO-405: Authentication is always on; only an explicit configuration flag
// (ApiSettings:RequireAuthentication=false, set in appsettings.Development.json)
// bypasses authorization for local development without Teams SSO.
var requireAuthentication = builder.Configuration.GetValue<bool?>("ApiSettings:RequireAuthentication") ?? true;

if (!requireAuthentication)
{
    builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, DevelopmentAllowAnonymousHandler>();
}

// CORS - allow local dev plus configured production frontends
var configuredOrigins = builder.Configuration.GetSection("ApiSettings:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
var defaultOrigins = new[]
{
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4321",
    "http://127.0.0.1:4321",
    "https://rpp-api.example.com"
};
var allowedOrigins = configuredOrigins
    .Concat(defaultOrigins)
    .Where(origin => !string.IsNullOrWhiteSpace(origin))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

builder.Services.AddControllers();

var app = builder.Build();

// EO-430 delivery stages 1-3: an incomplete store must announce itself on every start, not only in
// the configuration file somebody set months ago. Warning level, because a save against this
// installation will throw.
if (planningStore == PlanningStoreProvider.SharePoint)
{
    app.Logger.LogWarning(
        "Planning store 'sharepoint' is running as an INCOMPLETE provider (EO-430, stage 1 of 4). " +
        "Reads are served from SharePoint lists; every write throws. Enabled by " +
        "'{SectionName}:AllowIncompleteProvider'. Do not use this configuration for production data.",
        SharePointSettings.SectionName);
}

// EO-405: developer tooling must never be reachable in a deployed environment. The
// environment name alone proved too weak a guard — the RC5 deployment ran with
// ASPNETCORE_ENVIRONMENT=Development and served /swagger publicly. Both the Development
// environment AND an explicit opt-in are now required; the opt-in lives in
// appsettings.Development.json, which is excluded from the publish output.
var enableDeveloperTools = app.Environment.IsDevelopment()
    && app.Configuration.GetValue<bool>("ApiSettings:EnableDeveloperTools");

if (enableDeveloperTools)
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseDeveloperExceptionPage();
}
else if (app.Environment.IsDevelopment())
{
    app.Logger.LogInformation(
        "Developer tools are off (Swagger, developer exception page). Set ApiSettings:EnableDeveloperTools=true for local development.");
}

// Serve the React SPA (dist build copied to wwwroot) from the same origin as the API.
// EO-420: Teams webviews cache heuristically without explicit headers, which left tabs
// on stale bundles after deployments. Hashed /assets files are immutable; everything
// else (index.html, config/runtime-config.js, release.json) must revalidate.
var spaStaticFileOptions = new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var isHashedAsset = ctx.Context.Request.Path.StartsWithSegments("/assets");
        ctx.Context.Response.Headers.CacheControl = isHashedAsset
            ? "public,max-age=31536000,immutable"
            : "no-cache";
    }
};
app.UseResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles(spaStaticFileOptions);

app.Use(async (context, next) =>
{
    if (!context.Response.Headers.ContainsKey("X-Content-Type-Options"))
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    if (!context.Response.Headers.ContainsKey("Referrer-Policy"))
    {
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
    }

    if (!context.Response.Headers.ContainsKey("Permissions-Policy"))
    {
        context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    }

    if (!context.Response.Headers.ContainsKey("Content-Security-Policy"))
    {
        // frame-ancestors must allow the New Teams client (*.cloud.microsoft). Multiple CSP
        // headers (e.g. Kestrel + nginx) are AND-combined by the browser — a short list here
        // blocks Teams even when nginx allows it, and Chrome shows "refused to connect".
        context.Response.Headers["Content-Security-Policy"] =
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: https://graph.microsoft.com https://*.sharepoint.com; " +
            "connect-src 'self' https://graph.microsoft.com https://*.sharepoint.com; " +
            "font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; " +
            "frame-ancestors 'self' " +
            "https://teams.microsoft.com https://*.teams.microsoft.com " +
            "https://*.microsoft365.com https://*.office.com " +
            "https://outlook.office.com https://outlook.office365.com " +
            "https://*.cloud.microsoft https://*.sharepoint.com; " +
            "upgrade-insecure-requests";
    }

    await next();
});

// Order is important (CORS before Authentication per Microsoft.Identity.Web recommendations)
app.UseCors("AllowFrontend");

app.UseAuthentication();
app.UseAuthorization();

if (!requireAuthentication)
{
    app.Logger.LogWarning(
        "AUTHORIZATION BYPASS ACTIVE: ApiSettings:RequireAuthentication is false. " +
        "All [Authorize] requirements auto-succeed. Never use this setting in production (EO-405).");
}

app.MapControllers();

// SPA client-side routing: any non-API, non-file route falls back to index.html
app.MapFallbackToFile("index.html", spaStaticFileOptions);

// EO-405: schema migration and test-data seeding are separate concerns and must not share
// a gate. Migrations belong in every environment — docs/deployment.md grants the App
// Service identity db_ddladmin for exactly this. Seeding writes demo data and must never
// reach a deployed database, so it requires the Development environment AND an explicit
// opt-in. Both were previously behind a single IsDevelopment() check, which meant the
// RC5 deployment seeded test data into rpp-db-dev on every restart.
// EO-430 / EO-458: schema and seeding belong to the relational profile (SQL Server or PostgreSQL).
// In sharepoint/mock there is no DbContext registered, so this block is skipped.
if (planningStore is PlanningStoreProvider.Sql or PlanningStoreProvider.Postgres)
{
    using var startupScope = app.Services.CreateScope();
    var context = startupScope.ServiceProvider.GetRequiredService<RppDbContext>();

    if (string.IsNullOrWhiteSpace(app.Configuration.GetConnectionString("DefaultConnection")))
    {
        app.Logger.LogWarning(
            "No ConnectionStrings:DefaultConnection configured. Skipping database schema setup; planning endpoints backed by the database will fail.");
    }
    else if (planningStore == PlanningStoreProvider.Sql)
    {
        app.Logger.LogInformation("Applying SQL Server EF Core migrations.");
        context.Database.Migrate();
    }
    else
    {
        // PostgreSQL v1 (ADR-007): create tables from the current model when the database is empty.
        // SQL Server migration history is not portable; dual migration assemblies are a follow-up.
        var creator = context.Database.GetService<Microsoft.EntityFrameworkCore.Storage.IRelationalDatabaseCreator>();
        if (!creator.HasTables())
        {
            app.Logger.LogInformation(
                "PostgreSQL database has no tables. Creating schema from the current EF model (EO-458).");
            creator.CreateTables();
        }
        else
        {
            app.Logger.LogInformation(
                "PostgreSQL database already has tables. Skipping CreateTables. " +
                "In-place model upgrades are not yet driven by EF migrations for postgres — see ADR-007.");
        }
    }

    var seedDevelopmentData = app.Environment.IsDevelopment()
        && app.Configuration.GetValue<bool>("ApiSettings:SeedDevelopmentData");

    if (seedDevelopmentData)
    {
        var graphService = startupScope.ServiceProvider.GetRequiredService<GraphTeamMembershipService>();
        DataSeeder.SeedAsync(context, graphService).GetAwaiter().GetResult();
        app.Logger.LogWarning(
            "Development data seeding completed. Never enable ApiSettings:SeedDevelopmentData against a shared or deployed database.");
    }
}
else
{
    app.Logger.LogInformation(
        "Planning store '{PlanningStore}' selected. Database schema setup and seeding skipped.",
        planningStore.ToString().ToLowerInvariant());
}

app.Run();