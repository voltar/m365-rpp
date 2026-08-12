using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;
using RppWebApi.Models;

namespace RppWebApi.Services;

/// <summary>
/// EO-424: Inbound Outlook mailbox sync service.
/// Polls a shared mailbox for unread messages with .ics calendar attachments,
/// parses them, and creates/updates/deletes absence records in the RPP database.
///
/// Permission model: application permission Mail.ReadWrite scoped to the single
/// shared mailbox via an Exchange Application Access Policy (same pattern as EO-414).
/// </summary>
public class MailboxSyncService
{
    private const string GraphBaseUrl = "https://graph.microsoft.com/v1.0";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly MailboxSyncSettings _settings;
    private readonly IPlanningRepository _repository;
    private readonly MailboxSyncState _state;
    private readonly ILogger<MailboxSyncService> _logger;

    public MailboxSyncService(
        HttpClient httpClient,
        ITokenAcquisition tokenAcquisition,
        IOptions<MailboxSyncSettings> settings,
        IPlanningRepository repository,
        MailboxSyncState state,
        ILogger<MailboxSyncService> logger)
    {
        _httpClient = httpClient;
        _tokenAcquisition = tokenAcquisition;
        _settings = settings.Value;
        _repository = repository;
        _state = state;
        _logger = logger;
    }

    /// <summary>Result of a single sync cycle.</summary>
    public sealed class SyncResult
    {
        public DateTime StartedAt { get; init; }
        public DateTime? CompletedAt { get; set; }
        public int MessagesProcessed { get; set; }
        public int AbsencesCreated { get; set; }
        public int AbsencesUpdated { get; set; }
        public int AbsencesDeleted { get; set; }
        public int Errors { get; set; }
        public int Skipped { get; set; }

        /// <summary>Why the cycle failed, when it did. Surfaced so the admin screen can say more
        /// than "0 processed".</summary>
        public string? LastError { get; set; }

        public List<SyncEntry> Entries { get; init; } = new();
    }

    public sealed class SyncEntry
    {
        public string? MessageId { get; init; }
        public string? MessageSubject { get; init; }
        public string? Action { get; set; } // created, updated, deleted, skipped, error
        public string? EmployeeId { get; set; }
        public string? Detail { get; set; }
    }

    /// <summary>
    /// Most recent sync result. Held in the singleton <see cref="MailboxSyncState"/> because
    /// this service is transient - see that type for why.
    /// </summary>
    public SyncResult? LastSyncResult => _state.Last;

    /// <summary>Whether a sync cycle is currently running, across all instances.</summary>
    public bool IsRunning => _state.IsRunning;

    public bool IsEnabled => _settings.Enabled;

    /// <summary>
    /// Executes a full sync cycle: fetch unread messages, parse .ics attachments,
    /// upsert/delete absences, mark messages as read.
    /// </summary>
    public async Task<SyncResult> RunSyncAsync(CancellationToken cancellationToken = default)
    {
        if (!_settings.Enabled)
        {
            _logger.LogInformation("Mailbox sync is disabled. Skipping cycle.");
            return new SyncResult { StartedAt = DateTime.UtcNow, CompletedAt = DateTime.UtcNow };
        }

        if (!_state.TryBeginRun())
        {
            _logger.LogWarning("Mailbox sync cycle already in progress. Skipping.");
            return LastSyncResult ?? new SyncResult { StartedAt = DateTime.UtcNow, CompletedAt = DateTime.UtcNow };
        }

        var result = new SyncResult { StartedAt = DateTime.UtcNow };

        try
        {
            // EO-425: resolve effective mailbox address — DB value takes precedence over appsettings.
            var dbConfig = await _repository.GetMailboxSyncConfigAsync();
            var effectiveMailboxAddress = !string.IsNullOrWhiteSpace(dbConfig.MailboxAddress)
                ? dbConfig.MailboxAddress
                : _settings.MailboxAddress;

            var token = await _tokenAcquisition.GetAccessTokenForAppAsync("https://graph.microsoft.com/.default");
            var mailboxUserId = await ResolveMailboxUserIdAsync(token, effectiveMailboxAddress, cancellationToken);

            if (mailboxUserId is null)
            {
                _logger.LogError("Could not resolve mailbox user ID for {MailboxAddress}.", effectiveMailboxAddress);
                result.Errors++;
                return result;
            }

            // 1. Fetch unread messages
            var messages = await FetchUnreadMessagesAsync(mailboxUserId, token, cancellationToken);
            _logger.LogInformation("Mailbox sync: found {Count} unread messages.", messages.Count);

            foreach (var message in messages)
            {
                if (cancellationToken.IsCancellationRequested)
                    break;

                var entry = new SyncEntry
                {
                    MessageId = message.Id,
                    MessageSubject = message.Subject
                };

                try
                {
                    await ProcessMessageAsync(mailboxUserId, message, token, entry, result, cancellationToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Failed to process message {MessageId}: {Subject}", message.Id, message.Subject);
                    entry.Action = "error";
                    entry.Detail = MailboxSyncText.Describe(ex);
                    result.Errors++;
                }

                result.Entries.Add(entry);
                result.MessagesProcessed++;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Mailbox sync cycle failed.");
            result.Errors++;
            result.LastError = MailboxSyncText.Describe(ex);
        }
        finally
        {
            result.CompletedAt = DateTime.UtcNow;
            _state.CompleteRun(result);
        }

        _logger.LogInformation(
            "Mailbox sync completed: {Processed} processed, {Created} created, {Updated} updated, {Deleted} deleted, {Errors} errors, {Skipped} skipped.",
            result.MessagesProcessed, result.AbsencesCreated, result.AbsencesUpdated,
            result.AbsencesDeleted, result.Errors, result.Skipped);

        return result;
    }

    // ── Private helpers ────────────────────────────────────────────────

    private async Task<string?> ResolveMailboxUserIdAsync(string token, string mailboxAddress, CancellationToken ct)
    {
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(mailboxAddress)}?$select=id";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to resolve mailbox user: HTTP {StatusCode}", (int)response.StatusCode);
            return null;
        }

        var body = await response.Content.ReadAsStringAsync(ct);
        return JsonNode.Parse(body)?["id"]?.GetValue<string>();
    }

    private async Task<List<GraphMessage>> FetchUnreadMessagesAsync(
        string mailboxUserId, string token, CancellationToken ct)
    {
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(mailboxUserId)}/messages"
                + "?$filter=isRead eq false"
                + "&$select=id,subject,from,hasAttachments,receivedDateTime"
                + $"&$top={_settings.BatchSize}"
                + "&$orderby=receivedDateTime asc";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            // Deliberately fatal for the cycle rather than an empty list: returning nothing made a
            // rejected Graph call indistinguishable from an empty mailbox on the status screen -
            // both showed 0 processed, 0 errors. That cost an hour of misdiagnosis during rollout
            // when Graph answered 403 because the application permission was not consented.
            _logger.LogError("Failed to fetch messages: HTTP {StatusCode}", (int)response.StatusCode);

            throw new MailboxSyncUnavailableException(
                $"Microsoft Graph refused the mailbox query with HTTP {(int)response.StatusCode}. "
                + "Check that the application permission Mail.ReadWrite is granted and consented, "
                + "and that the Exchange application access policy covers this mailbox.");
        }

        var body = await response.Content.ReadAsStringAsync(ct);
        var json = JsonNode.Parse(body);
        var items = json?["value"]?.AsArray();

        if (items is null)
            return new List<GraphMessage>();

        return items
            .Where(item => item is not null)
            .Select(item => new GraphMessage
        {
            Id = item!["id"]?.GetValue<string>() ?? "",
            Subject = item!["subject"]?.GetValue<string>() ?? "",
            SenderEmail = item!["from"]?["emailAddress"]?["address"]?.GetValue<string>(),
            HasAttachments = item!["hasAttachments"]?.GetValue<bool>() ?? false,
            ReceivedDateTime = item!["receivedDateTime"]?.GetValue<DateTime>() ?? DateTime.MinValue
        }).ToList();
    }

    private async Task ProcessMessageAsync(
        string mailboxUserId,
        GraphMessage message,
        string token,
        SyncEntry entry,
        SyncResult result,
        CancellationToken ct)
    {
        // 2. Collect the calendar payloads this message carries, whatever shape they arrive in.
        var payloads = await CollectCalendarPayloadsAsync(mailboxUserId, message, token, ct);

        if (payloads.Count == 0)
        {
            _logger.LogWarning(
                "Message {MessageId} carries no calendar data (hasAttachments={HasAttachments}). Marking as read.",
                message.Id, message.HasAttachments);
            await MarkAsReadAsync(mailboxUserId, message.Id, token, ct);
            entry.Action = "skipped";
            entry.Detail = message.HasAttachments
                ? "No calendar data: neither an .ics attachment nor a text/calendar MIME part"
                : "No calendar data: no text/calendar MIME part";
            result.Skipped++;
            return;
        }

        // 3. Parse each payload
        foreach (var payload in payloads)
        {
            var icsEvent = IcsParser.Parse(payload.Content);
            if (icsEvent is null)
            {
                // Counted, not swallowed: an unparseable payload used to leave the entry with no
                // action at all, which read on the status screen as if nothing had happened.
                _logger.LogWarning("Failed to parse calendar data for message {MessageId} from {Origin}.",
                    message.Id, payload.Origin);
                entry.Action = "skipped";
                entry.Detail = $"Calendar data from {payload.Origin} could not be parsed";
                result.Skipped++;
                continue;
            }

            // 4. Match employee by organizer email, falling back to the message sender.
            // A plain appointment forwarded out of Outlook can arrive without an ORGANIZER property
            // at all - there was never a meeting to organise. The sender is then the only identity
            // the message carries, and for the case this EO describes ("I forward my own absence")
            // it is the same person. ORGANIZER still wins when present, so forwarding someone
            // else's meeting keeps attributing the absence to its owner.
            var identity = icsEvent.OrganizerEmail;
            if (string.IsNullOrWhiteSpace(identity))
            {
                identity = message.SenderEmail;
            }

            var employeeId = await MatchEmployeeAsync(identity);

            // An ORGANIZER that is present but belongs to nobody is the second shape of the same
            // problem: Google names a group calendar there
            // (…@group.calendar.google.com), Exchange can name a room or an external organiser.
            // Whoever that is, the person who forwarded the message to the absence mailbox is the
            // one making the statement about their own absence, so fall through to them. An
            // ORGANIZER that does resolve still wins, which keeps someone else's meeting attributed
            // to its owner.
            if (employeeId is null
                && !string.IsNullOrWhiteSpace(message.SenderEmail)
                && !string.Equals(identity, message.SenderEmail, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation(
                    "Organizer {Organizer} matched no employee; falling back to sender {Sender}.",
                    identity, message.SenderEmail);
                identity = message.SenderEmail;
                employeeId = await MatchEmployeeAsync(identity);
            }

            if (employeeId is null)
            {
                _logger.LogWarning(
                    "No RPP employee match for {Identity} in message {MessageId}. Skipping.",
                    identity, message.Id);
                entry.Action = "skipped";
                entry.Detail = string.IsNullOrWhiteSpace(identity)
                    ? "No employee match: message carries neither an organizer nor a sender address"
                    : $"No employee match for {identity}";
                result.Skipped++;
                continue;
            }

            entry.EmployeeId = employeeId;

            // 5. Determine action: CANCEL → delete, otherwise upsert
            var isCancel = string.Equals(icsEvent.Method, "CANCEL", StringComparison.OrdinalIgnoreCase);

            if (isCancel)
            {
                await HandleCancelAsync(icsEvent, entry, result);
            }
            else
            {
                await HandleUpsertAsync(icsEvent, employeeId, entry, result);
            }
        }

        // 6. Mark message as read
        await MarkAsReadAsync(mailboxUserId, message.Id, token, ct);
    }

    private async Task HandleUpsertAsync(
        IcsParser.IcsEvent icsEvent, string employeeId, SyncEntry entry, SyncResult result)
    {
        // Determine absence type from subject
        var type = ResolveAbsenceType(icsEvent.Summary);

        // Check for existing absence by IcsUid
        var existing = !string.IsNullOrEmpty(icsEvent.Uid)
            ? await _repository.GetAbsenceByIcsUidAsync(icsEvent.Uid)
            : null;

        var (startDate, startHalf, endDate, endHalf) = MapDates(icsEvent);

        if (existing is not null)
        {
            // Update existing
            existing.Type = type;
            existing.StartDate = startDate;
            existing.StartHalf = startHalf;
            existing.EndDate = endDate;
            existing.EndHalf = endHalf;
            existing.Comment = icsEvent.Description ?? existing.Comment;
            existing.Modified = DateTime.UtcNow;

            await _repository.SaveAbsenceAsync(existing);
            entry.Action = "updated";
            result.AbsencesUpdated++;
            _logger.LogInformation("Updated absence {AbsenceId} (IcsUid={IcsUid}) for {EmployeeId}.",
                existing.Id, icsEvent.Uid, employeeId);
        }
        else
        {
            // Check for date overlap (duplicate detection)
            var overlapping = await _repository.GetAbsencesByEmployeeAndDateRangeAsync(
                employeeId, startDate, endDate);

            if (overlapping.Any(a => a.Status != "deleted"))
            {
                _logger.LogInformation(
                    "Skipping duplicate: employee {EmployeeId} already has an absence covering {StartDate}-{EndDate}.",
                    employeeId, startDate.ToString("yyyy-MM-dd"), endDate.ToString("yyyy-MM-dd"));
                entry.Action = "skipped";
                entry.Detail = "Duplicate date range";
                result.Skipped++;
                return;
            }

            // Create new absence
            var absence = new AbsenceDto
            {
                Id = $"abs-{Guid.NewGuid().ToString()[..12]}",
                EmployeeId = employeeId,
                Type = type,
                StartDate = startDate,
                StartHalf = startHalf,
                EndDate = endDate,
                EndHalf = endHalf,
                Duration = CalculateDuration(startDate, startHalf, endDate, endHalf),
                Comment = MailboxSyncText.Clamp(icsEvent.Description, MailboxSyncText.CommentMaxLength),
                Status = "approved",
                ApprovalStatus = "approved",
                IcsUid = MailboxSyncText.Clamp(icsEvent.Uid, MailboxSyncText.IcsUidMaxLength),
                Source = "outlook-mailbox",
                Created = DateTime.UtcNow,
                Modified = DateTime.UtcNow
            };

            await _repository.SaveAbsenceAsync(absence);
            entry.Action = "created";
            result.AbsencesCreated++;
            _logger.LogInformation("Created absence {AbsenceId} (IcsUid={IcsUid}) for {EmployeeId}.",
                absence.Id, icsEvent.Uid, employeeId);
        }
    }

    private async Task HandleCancelAsync(
        IcsParser.IcsEvent icsEvent, SyncEntry entry, SyncResult result)
    {
        if (string.IsNullOrEmpty(icsEvent.Uid))
        {
            entry.Action = "skipped";
            entry.Detail = "CANCEL without UID";
            result.Skipped++;
            return;
        }

        var existing = await _repository.GetAbsenceByIcsUidAsync(icsEvent.Uid);
        if (existing is null)
        {
            entry.Action = "skipped";
            entry.Detail = "CANCEL for unknown UID (idempotent)";
            result.Skipped++;
            return;
        }

        await _repository.DeleteAbsenceAsync(existing.Id);
        entry.Action = "deleted";
        result.AbsencesDeleted++;
        _logger.LogInformation("Deleted absence {AbsenceId} (IcsUid={IcsUid}) due to CANCEL.",
            existing.Id, icsEvent.Uid);
    }

    /// <summary>
    /// Resolves the RPP absence type from the event subject.
    /// Strategy: keyword matching first, then 1:1 fallback to the raw subject.
    /// </summary>
    private string ResolveAbsenceType(string? subject)
    {
        if (string.IsNullOrWhiteSpace(subject))
            return _settings.DefaultAbsenceType;

        // Try keyword matching (case-insensitive, first match wins)
        foreach (var (keyword, type) in _settings.TypeKeywords)
        {
            if (subject.Contains(keyword, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogDebug("Absence type resolved via keyword '{Keyword}' → '{Type}' from subject '{Subject}'.",
                    keyword, type, subject);
                return type;
            }
        }

        // Fallback: use the raw subject as the type (1:1). A subject has no length limit, the column
        // does — an unclamped one would reach the database and fail the whole message.
        var sanitized = MailboxSyncText.Clamp(subject.Trim().ToLowerInvariant().Replace(' ', '-'), MailboxSyncText.TypeMaxLength)!;
        _logger.LogDebug("No keyword match for subject '{Subject}'. Using 1:1 fallback type '{Type}'.",
            subject, sanitized);
        return sanitized;
    }


    /// <summary>
    /// Maps iCalendar dates to RPP date/half-day fields.
    /// All-day events: startHalf/endHalf = "full".
    /// Timed events: detect half-day based on business hours.
    /// </summary>
    private (DateTime startDate, string startHalf, DateTime endDate, string endHalf) MapDates(
        IcsParser.IcsEvent icsEvent)
    {
        if (!icsEvent.Start.HasValue || !icsEvent.End.HasValue)
            return (DateTime.UtcNow, "full", DateTime.UtcNow, "full");

        var start = icsEvent.Start.Value;
        // iCalendar DTEND is exclusive; for all-day events subtract 1 day
        var end = icsEvent.IsAllDay ? icsEvent.End.Value.AddDays(-1) : icsEvent.End.Value;

        if (icsEvent.IsAllDay)
        {
            return (start.Date, "full", end.Date, "full");
        }

        // Timed event: detect half-day
        var startHalf = DetectHalfDay(start, isStart: true);
        var endHalf = DetectHalfDay(end, isStart: false);

        return (start.Date, startHalf, end.Date, endHalf);
    }

    private string DetectHalfDay(DateTime dateTime, bool isStart)
    {
        if (!TimeSpan.TryParse(_settings.BusinessHoursStart, out var bizStart) ||
            !TimeSpan.TryParse(_settings.BusinessHoursEnd, out var bizEnd))
        {
            return "full";
        }

        var time = dateTime.TimeOfDay;
        var midday = bizStart + TimeSpan.FromTicks((bizEnd - bizStart).Ticks / 2);

        if (isStart)
        {
            // Start in morning = full first day; start in afternoon = half day (subtract 0.5)
            return time <= midday ? "full" : "afternoon";
        }
        else
        {
            // End in morning = half day (subtract 0.5); end in afternoon = full last day
            return time <= midday ? "morning" : "full";
        }
    }

    // EO-430: the formula moved to AbsenceDuration so the SharePoint provider, which computes this
    // on read instead of storing it, cannot drift from what the mailbox sync writes.
    private static decimal CalculateDuration(
        DateTime startDate, string startHalf, DateTime endDate, string endHalf) =>
        AbsenceDuration.Calculate(startDate, startHalf, endDate, endHalf);

    private async Task<string?> MatchEmployeeAsync(string? organizerEmail)
    {
        if (string.IsNullOrWhiteSpace(organizerEmail))
            return null;

        var identity = organizerEmail.Trim();
        var memberships = await _repository.GetTeamMembershipsAsync();
        var items = memberships.Items;

        // 1) Direct match on Graph mail from the membership snapshot.
        var byMail = items.FirstOrDefault(m =>
            !string.IsNullOrWhiteSpace(m.Member.Mail)
            && string.Equals(m.Member.Mail, identity, StringComparison.OrdinalIgnoreCase));
        if (byMail is not null)
        {
            return byMail.Member.Id;
        }

        // 2) Resolve mail/UPN → Entra object id, then match RPP assignments by id.
        // Team Admin shows the address from a full Graph-backed details load; mailbox sync
        // previously only saw empty Mail on assignment-only membership DTOs (Host Europe
        // without Graph:TeamGroupId) → "No employee match" despite the person being listed.
        var graphUserId = await ResolveGraphUserIdByEmailAsync(identity);
        if (string.IsNullOrWhiteSpace(graphUserId))
        {
            _logger.LogWarning(
                "No employee match for {Identity}: Graph did not resolve a user (memberships={MembershipCount}).",
                identity,
                items.Count);
            return null;
        }

        var byId = items.FirstOrDefault(m =>
            string.Equals(m.Member.Id, graphUserId, StringComparison.OrdinalIgnoreCase));
        if (byId is not null)
        {
            _logger.LogInformation(
                "Matched mailbox identity {Identity} to employee {EmployeeId} via membership object id.",
                identity,
                graphUserId);
            return byId.Member.Id;
        }

        // 3) Authoritative assignment table (same source as Team Admin member list).
        var assignedIds = await _repository.ListAssignedUserIdsAsync();
        var assigned = assignedIds.FirstOrDefault(id =>
            string.Equals(id, graphUserId, StringComparison.OrdinalIgnoreCase));
        if (assigned is not null)
        {
            _logger.LogInformation(
                "Matched mailbox identity {Identity} to assigned user {EmployeeId} (assignments={AssignmentCount}, memberships={MembershipCount}).",
                identity,
                assigned,
                assignedIds.Count,
                items.Count);
            return assigned;
        }

        _logger.LogWarning(
            "No employee match for {Identity}: Graph user {GraphUserId} is not in RPP assignments (assignments={AssignmentCount}, memberships={MembershipCount}).",
            identity,
            graphUserId,
            assignedIds.Count,
            items.Count);
        return null;
    }

    /// <summary>
    /// Resolves mail or UPN to an Entra object id (application token).
    /// Tries direct /users/{key} then $filter on mail and userPrincipalName (guests/aliases).
    /// </summary>
    private async Task<string?> ResolveGraphUserIdByEmailAsync(string emailOrUpn)
    {
        try
        {
            var token = await _tokenAcquisition.GetAccessTokenForAppAsync("https://graph.microsoft.com/.default");

            var direct = await GetGraphJsonAsync(
                $"{GraphBaseUrl}/users/{Uri.EscapeDataString(emailOrUpn)}?$select=id,mail,userPrincipalName",
                token);
            var directId = direct?["id"]?.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(directId))
            {
                return directId;
            }

            // Guests / alternate addresses: filter is more reliable than path lookup.
            var escaped = emailOrUpn.Replace("'", "''", StringComparison.Ordinal);
            var filter = Uri.EscapeDataString($"mail eq '{escaped}' or userPrincipalName eq '{escaped}'");
            var list = await GetGraphJsonAsync(
                $"{GraphBaseUrl}/users?$filter={filter}&$select=id,mail,userPrincipalName&$top=5",
                token);
            var first = list?["value"]?.AsArray()?.FirstOrDefault();
            var filteredId = first?["id"]?.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(filteredId))
            {
                return filteredId;
            }

            _logger.LogWarning("Graph user lookup found no user for identity {Identity}.", emailOrUpn);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Graph user lookup failed for {Identity}.", emailOrUpn);
            return null;
        }
    }

    private async Task<JsonNode?> GetGraphJsonAsync(string url, string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new("Bearer", token);
        // Consistency level required for advanced filters on some tenants.
        request.Headers.TryAddWithoutValidation("ConsistencyLevel", "eventual");

        var response = await _httpClient.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogWarning(
                "Graph GET {Url} returned HTTP {StatusCode}: {Body}",
                url,
                (int)response.StatusCode,
                body.Length > 300 ? body[..300] : body);
            return null;
        }

        var json = await response.Content.ReadAsStringAsync();
        return JsonNode.Parse(json);
    }

    // ── Calendar payload collection ────────────────────────────────────

    /// <summary>
    /// Returns every iCalendar payload a message carries, in the order the routes are tried.
    ///
    /// Two routes, because senders disagree on how calendar data travels. A hand-attached file and
    /// Gmail deliver a <c>.ics</c> file attachment. An appointment forwarded from Outlook arrives as
    /// an Exchange meeting request: the calendar data <i>is</i> the message, Graph reports
    /// <c>hasAttachments: false</c>, and the attachments collection is empty. That second shape is
    /// the one the user story describes, and the attachment-only implementation rejected it.
    ///
    /// The raw MIME route covers both, so it runs whenever the attachment route came up empty -
    /// including for messages that claim no attachments at all.
    /// </summary>
    private async Task<List<CalendarPayload>> CollectCalendarPayloadsAsync(
        string mailboxUserId, GraphMessage message, string token, CancellationToken ct)
    {
        var payloads = new List<CalendarPayload>();

        if (message.HasAttachments)
        {
            foreach (var att in await FetchIcsAttachmentsAsync(mailboxUserId, message.Id, token, ct))
            {
                var content = await DownloadAttachmentAsync(mailboxUserId, message.Id, att.Id, token, ct);
                if (!string.IsNullOrWhiteSpace(content))
                {
                    payloads.Add(new CalendarPayload(content, $"attachment '{att.Name}'"));
                }
            }
        }

        if (payloads.Count > 0)
        {
            return payloads;
        }

        var mime = await FetchRawMimeAsync(mailboxUserId, message.Id, token, ct);
        var extracted = MimeCalendarExtractor.Extract(mime);

        if (!string.IsNullOrWhiteSpace(extracted))
        {
            _logger.LogInformation(
                "Message {MessageId} carried its calendar data as a MIME part, not as an attachment.",
                message.Id);
            payloads.Add(new CalendarPayload(extracted, "the raw MIME body"));
        }

        return payloads;
    }

    // ── Microsoft Graph helpers ────────────────────────────────────────

    /// <summary>
    /// Downloads the message as raw MIME (RFC 5322). Unlike the mailbox query, a failure here is
    /// not fatal for the cycle: it concerns one message, and the caller reports it as a skip.
    /// </summary>
    private async Task<string?> FetchRawMimeAsync(
        string mailboxUserId, string messageId, string token, CancellationToken ct)
    {
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(mailboxUserId)}/messages/{messageId}/$value";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Failed to download raw MIME for message {MessageId}: HTTP {StatusCode}",
                messageId, (int)response.StatusCode);
            return null;
        }

        return await response.Content.ReadAsStringAsync(ct);
    }

    private async Task<List<GraphAttachmentRef>> FetchIcsAttachmentsAsync(
        string mailboxUserId, string messageId, string token, CancellationToken ct)
    {
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(mailboxUserId)}/messages/{messageId}/attachments"
                + "?$filter=isInline eq false";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to fetch attachments for message {MessageId}: HTTP {StatusCode}",
                messageId, (int)response.StatusCode);
            return new List<GraphAttachmentRef>();
        }

        var body = await response.Content.ReadAsStringAsync(ct);
        var json = JsonNode.Parse(body);
        var items = json?["value"]?.AsArray();

        if (items is null)
            return new List<GraphAttachmentRef>();

        return items
            .Where(item => item is not null)
            .Where(item =>
            {
                var type = item!["@odata.type"]?.GetValue<string>() ?? "";
                var name = item!["name"]?.GetValue<string>() ?? "";
                return type.Contains("fileAttachment", StringComparison.OrdinalIgnoreCase)
                       && name.EndsWith(".ics", StringComparison.OrdinalIgnoreCase);
            })
            .Select(item => new GraphAttachmentRef
            {
                Id = item!["id"]?.GetValue<string>() ?? "",
                Name = item!["name"]?.GetValue<string>() ?? ""
            })
            .ToList();
    }

    private async Task<string?> DownloadAttachmentAsync(
        string mailboxUserId, string messageId, string attachmentId, string token, CancellationToken ct)
    {
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(mailboxUserId)}/messages/{messageId}/attachments/{attachmentId}/$value";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to download attachment {AttachmentId}: HTTP {StatusCode}",
                attachmentId, (int)response.StatusCode);
            return null;
        }

        return await response.Content.ReadAsStringAsync(ct);
    }

    private async Task MarkAsReadAsync(
        string mailboxUserId, string messageId, string token, CancellationToken ct)
    {
        var url = $"{GraphBaseUrl}/users/{Uri.EscapeDataString(mailboxUserId)}/messages/{messageId}";
        var payload = new { isRead = true };

        using var request = new HttpRequestMessage(HttpMethod.Patch, url)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };
        request.Headers.Authorization = new("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Failed to mark message {MessageId} as read: HTTP {StatusCode}",
                messageId, (int)response.StatusCode);
        }
    }

    // ── Internal DTOs ──────────────────────────────────────────────────

    private sealed class GraphMessage
    {
        public string Id { get; init; } = "";
        public string Subject { get; init; } = "";

        /// <summary>Address the message was sent from - the fallback identity when the iCalendar
        /// payload has no ORGANIZER.</summary>
        public string? SenderEmail { get; init; }

        public bool HasAttachments { get; init; }
        public DateTime ReceivedDateTime { get; init; }
    }

    private sealed class GraphAttachmentRef
    {
        public string Id { get; init; } = "";
        public string Name { get; init; } = "";
    }

    /// <summary>
    /// One iCalendar payload plus where it came from. The origin is not decoration: it is what the
    /// status screen shows when a payload fails to parse, and it says which of the two routes the
    /// sender actually used.
    /// </summary>
    private sealed record CalendarPayload(string Content, string Origin);
}

/// <summary>
/// EO-424: raised when Microsoft Graph refuses the mailbox query, so the cycle ends with a
/// visible error instead of a silent zero.
/// </summary>
public sealed class MailboxSyncUnavailableException : Exception
{
    public MailboxSyncUnavailableException(string message) : base(message)
    {
    }
}
