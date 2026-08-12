using Cronos;

namespace RppWebApi.Services;

/// <summary>
/// EO-424: Background service that polls the shared mailbox on a configurable
/// cron schedule. Uses Cronos for cron expression parsing.
/// </summary>
public class MailboxSyncBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly MailboxSyncSettings _settings;
    private readonly ILogger<MailboxSyncBackgroundService> _logger;

    public MailboxSyncBackgroundService(
        IServiceScopeFactory scopeFactory,
        Microsoft.Extensions.Options.IOptions<MailboxSyncSettings> settings,
        ILogger<MailboxSyncBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _settings = settings.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.Enabled)
        {
            _logger.LogInformation("MailboxSync background service is disabled. Not starting poll loop.");
            return;
        }

        _logger.LogInformation(
            "MailboxSync background service started. Cron: {Cron}, Mailbox: {Mailbox}",
            _settings.CronExpression, _settings.MailboxAddress);

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = CalculateDelayUntilNextRun();

            if (delay > TimeSpan.Zero)
            {
                _logger.LogDebug("Next mailbox sync in {Delay}.", delay);
                await Task.Delay(delay, stoppingToken);
            }

            if (stoppingToken.IsCancellationRequested)
                break;

            try
            {
                _logger.LogInformation("MailboxSync background service: starting scheduled sync cycle.");
                using var scope = _scopeFactory.CreateScope();
                var syncService = scope.ServiceProvider.GetRequiredService<MailboxSyncService>();
                await syncService.RunSyncAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "MailboxSync background service: sync cycle failed.");
            }
        }
    }

    /// <summary>
    /// Calculates the delay until the next cron occurrence.
    /// Falls back to 4 hours if the cron expression is invalid.
    /// </summary>
    private TimeSpan CalculateDelayUntilNextRun()
    {
        try
        {
            var format = _settings.CronExpression.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Length == 6
                ? CronFormat.IncludeSeconds
                : CronFormat.Standard;
            var expression = CronExpression.Parse(_settings.CronExpression, format);
            var now = DateTime.UtcNow;
            var next = expression.GetNextOccurrence(now, TimeZoneInfo.Utc);

            if (next.HasValue)
            {
                var delay = next.Value - now;
                return delay > TimeSpan.Zero ? delay : TimeSpan.FromMinutes(1);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse cron expression '{Cron}'. Falling back to 4-hour interval.", _settings.CronExpression);
        }

        return TimeSpan.FromHours(4);
    }
}
