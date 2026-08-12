using System.ComponentModel.DataAnnotations;

namespace RppWebApi.Models;

/// <summary>
/// EO-425: tenant-wide mailbox sync configuration maintained from the App Admin Center.
/// Single-row table (fixed id) — stores the shared mailbox address used by MailboxSyncService.
/// All other MailboxSync settings (cron, batch size, keywords) remain in appsettings.json.
/// </summary>
public class MailboxSyncConfig
{
    public const string SingletonId = "default";

    [Key]
    [MaxLength(20)]
    public string Id { get; set; } = SingletonId;

    /// <summary>Shared mailbox email address. Overrides MailboxSyncSettings:MailboxAddress when non-empty.</summary>
    [MaxLength(320)]
    public string MailboxAddress { get; set; } = string.Empty;

    public DateTime LastModified { get; set; } = DateTime.UtcNow;
}

public class MailboxSyncConfigDto
{
    public string MailboxAddress { get; set; } = string.Empty;
}

/// <summary>Patch semantics: only non-null values are applied.</summary>
public class MailboxSyncConfigPatchDto
{
    public string? MailboxAddress { get; set; }
}
