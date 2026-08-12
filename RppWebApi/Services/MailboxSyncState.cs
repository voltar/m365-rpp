namespace RppWebApi.Services;

/// <summary>
/// EO-424 FR-424.9: holds the mailbox sync run state across requests.
///
/// This exists because <see cref="MailboxSyncService"/> is registered through
/// <c>AddHttpClient</c> and is therefore <b>transient</b>: the background service resolves a
/// fresh instance per cycle and each controller request resolves another one. Run state kept
/// on the service instance is discarded the moment the cycle ends, so
/// <c>GET /api/admin/mailbox-sync/status</c> could never report a scheduled run, and the
/// "already running" guard could not see a run started elsewhere.
///
/// Registered as a singleton. State is still in-memory and therefore resets when the app
/// restarts or scales out; the durable record of what was imported is
/// <c>Absences.Source = "outlook-mailbox"</c> in the database.
/// </summary>
public sealed class MailboxSyncState
{
    /// <summary>How many completed cycles are retained for the log endpoint.</summary>
    public const int MaxRetainedCycles = 20;

    private readonly object _gate = new();
    private readonly List<MailboxSyncService.SyncResult> _recent = new();

    private bool _isRunning;

    public bool IsRunning
    {
        get
        {
            lock (_gate)
            {
                return _isRunning;
            }
        }
    }

    public MailboxSyncService.SyncResult? Last
    {
        get
        {
            lock (_gate)
            {
                return _recent.Count > 0 ? _recent[^1] : null;
            }
        }
    }

    /// <summary>
    /// Claims the run slot. Returns false when a cycle is already in progress, which makes the
    /// guard effective across the background service and concurrent manual triggers.
    /// </summary>
    public bool TryBeginRun()
    {
        lock (_gate)
        {
            if (_isRunning)
            {
                return false;
            }

            _isRunning = true;
            return true;
        }
    }

    public void CompleteRun(MailboxSyncService.SyncResult result)
    {
        lock (_gate)
        {
            _recent.Add(result);

            if (_recent.Count > MaxRetainedCycles)
            {
                _recent.RemoveRange(0, _recent.Count - MaxRetainedCycles);
            }

            _isRunning = false;
        }
    }

    /// <summary>Completed cycles, newest first.</summary>
    public IReadOnlyList<MailboxSyncService.SyncResult> RecentCycles()
    {
        lock (_gate)
        {
            return _recent.AsEnumerable().Reverse().ToList();
        }
    }
}
