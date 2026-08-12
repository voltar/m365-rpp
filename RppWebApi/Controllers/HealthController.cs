using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Npgsql;
using RppWebApi.Models;
using RppWebApi.Services;
using System.Reflection;

namespace RppWebApi.Controllers;

/// <summary>
/// Health endpoint used by the React frontend (App Admin Center + PlanningBootstrap).
/// Supports both /health and /api/health to match frontend expectations.
/// </summary>
[ApiController]
[AllowAnonymous]
public class HealthController : ControllerBase
{
    private readonly IWebHostEnvironment _environment;
    private readonly IConfiguration _configuration;
    private readonly PlanningStoreSelection _planningStore;

    public HealthController(
        IWebHostEnvironment environment,
        IConfiguration configuration,
        PlanningStoreSelection planningStore)
    {
        _environment = environment;
        _configuration = configuration;
        _planningStore = planningStore;
    }

    [HttpGet("/health")]
    [HttpGet("/api/health")]
    public ActionResult<HealthResponse> Get()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var informationalVersion = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;
        var sourceRevision = TryExtractSourceRevision(informationalVersion);
        var buildTimestamp = TryGetAssemblyBuildTimestamp(assembly);
        var (databaseServerName, databaseName) = _planningStore.IsRelational
            ? TryReadDatabaseTarget()
            : (null, null);
        var webServerName =
            Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME")
            ?? _environment.ApplicationName
            ?? Environment.MachineName;

        var response = new HealthResponse
        {
            Status = "healthy",
            Version = assembly.GetName().Version?.ToString() ?? "1.0.0",
            SourceRevision = sourceRevision,
            BuildTimestamp = buildTimestamp,
            Environment = _environment.EnvironmentName,
            Timestamp = DateTime.UtcNow,
            Message = "RPP Web API is running (Phase 2B). Connected to frontend successfully.",
            FrontendCompatible = true,
            SupportedDataSources = new[] { "api", "mock", "sharepoint" },
            BackendProvider = _planningStore.Provider switch
            {
                PlanningStoreProvider.Sql => "ASP.NET Core + EF Core + SQL Server",
                PlanningStoreProvider.Postgres => "ASP.NET Core + EF Core + PostgreSQL",
                PlanningStoreProvider.SharePoint => "ASP.NET Core + SharePoint Online lists",
                _ => "ASP.NET Core + in-memory mock data"
            },
            PlanningStore = _planningStore.Name,
            DatabaseServerName = databaseServerName,
            DatabaseName = databaseName,
            WebServerName = webServerName
        };

        return Ok(response);
    }

    private (string? ServerName, string? DatabaseName) TryReadDatabaseTarget()
    {
        try
        {
            var connectionString = _configuration.GetConnectionString("DefaultConnection");

            if (string.IsNullOrWhiteSpace(connectionString))
            {
                return (null, null);
            }

            if (_planningStore.Provider == PlanningStoreProvider.Postgres)
            {
                var npgsql = new NpgsqlConnectionStringBuilder(connectionString);
                var host = string.IsNullOrWhiteSpace(npgsql.Host) ? null : npgsql.Host;
                if (host is not null && npgsql.Port > 0)
                {
                    host = $"{host}:{npgsql.Port}";
                }

                var database = string.IsNullOrWhiteSpace(npgsql.Database) ? null : npgsql.Database;
                return (host, database);
            }

            var builder = new SqlConnectionStringBuilder(connectionString);
            var serverName = string.IsNullOrWhiteSpace(builder.DataSource) ? null : builder.DataSource;
            var databaseName = string.IsNullOrWhiteSpace(builder.InitialCatalog) ? null : builder.InitialCatalog;

            return (serverName, databaseName);
        }
        catch
        {
            return (null, null);
        }
    }

    private static string? TryExtractSourceRevision(string? informationalVersion)
    {
        if (string.IsNullOrWhiteSpace(informationalVersion))
        {
            return null;
        }

        var plusIndex = informationalVersion.IndexOf('+');

        return plusIndex >= 0 && plusIndex + 1 < informationalVersion.Length
            ? informationalVersion[(plusIndex + 1)..]
            : informationalVersion;
    }

    private static string? TryGetAssemblyBuildTimestamp(Assembly assembly)
    {
        try
        {
            var location = assembly.Location;

            if (string.IsNullOrWhiteSpace(location) || !System.IO.File.Exists(location))
            {
                return null;
            }

            return System.IO.File.GetLastWriteTimeUtc(location).ToString("O");
        }
        catch
        {
            return null;
        }
    }
}
