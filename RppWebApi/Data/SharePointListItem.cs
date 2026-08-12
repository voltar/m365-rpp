using System.Globalization;
using System.Text.Json;

namespace RppWebApi.Data;

/// <summary>
/// EO-430: a single SharePoint list item, read straight from the REST response.
///
/// Deliberately a thin reader over <see cref="JsonElement"/> rather than sixteen response classes.
/// The lists carry one column per fact and the mapping is flat, so a typed class per list would be
/// sixteen files that restate the column names the schema already owns — and every column added to
/// a list would then have to be added twice.
///
/// A missing or null column reads as the type's empty value. The lists are a second editing surface
/// (FR-430.14): a person can clear a field the application expects, and that must produce a row with
/// a gap, not a failed request for everybody.
/// </summary>
public readonly struct SharePointListItem
{
    private readonly JsonElement _element;

    public SharePointListItem(JsonElement element)
    {
        _element = element;
    }

    /// <summary>SharePoint's integer item id, the identity behind the API's string ids (FR-430.6).</summary>
    public int ItemId => GetInt("Id") ?? 0;

    /// <summary>Item ETag, used for <c>If-Match</c> writes in stage 2 (FR-430.13).</summary>
    public string? ETag => GetString("@odata.etag");

    public string GetString(string field, string fallback = "")
    {
        if (!TryGet(field, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? fallback,
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => fallback
        };
    }

    public string? GetOptionalString(string field)
    {
        var value = GetString(field);

        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    public int? GetInt(string field)
    {
        if (!TryGet(field, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var number) => number,
            JsonValueKind.String when int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    public decimal GetDecimal(string field, decimal fallback = 0m)
    {
        if (!TryGet(field, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => fallback
        };
    }

    public bool GetBoolean(string field, bool fallback = false)
    {
        if (!TryGet(field, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            // SharePoint returns Yes/No columns as 0/1 in some projections.
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => fallback
        };
    }

    /// <summary>
    /// Date-only columns come back as UTC midnight. Returned as <see cref="DateTimeKind.Unspecified"/>
    /// because a planning date is a calendar day, not an instant: converting it to local time is what
    /// moves an absence to the day before in a negative-offset timezone.
    /// </summary>
    public DateTime GetDate(string field)
    {
        var parsed = GetOptionalDateTime(field);

        return parsed is null ? default : DateTime.SpecifyKind(parsed.Value.Date, DateTimeKind.Unspecified);
    }

    public DateTime GetDateTime(string field) => GetOptionalDateTime(field) ?? default;

    public DateTime? GetOptionalDateTime(string field)
    {
        if (!TryGet(field, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTime.TryParse(
            value.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }

    /// <summary>
    /// Lookup id behind a <c>User</c> column. Null when the column is empty — which is a row whose
    /// person was cleared or never set, not an error (FR-430.12).
    /// </summary>
    public int? GetLookupId(string personField) =>
        GetInt(SharePointListSchema.People.LookupField(personField));

    private bool TryGet(string field, out JsonElement value)
    {
        if (_element.ValueKind == JsonValueKind.Object &&
            _element.TryGetProperty(field, out value) &&
            value.ValueKind != JsonValueKind.Null)
        {
            return true;
        }

        value = default;

        return false;
    }
}
