using System.Text;

namespace RppWebApi.Services;

/// <summary>
/// EO-424: pulls the iCalendar payload out of a raw MIME message.
///
/// The original implementation only accepted a `.ics` <b>file attachment</b>, which turned out to
/// reject the most natural user action. Forwarding an appointment from Outlook on the web sends an
/// Exchange meeting request: the calendar data is the message itself, Graph reports
/// <c>hasAttachments: false</c>, and there is no "forward as iCalendar" option in that client at
/// all. Gmail and Apple Mail deliver a <c>text/calendar</c> part that is sometimes an attachment
/// and sometimes inline.
///
/// Rather than special-casing each sender, this reads the raw MIME and takes the first
/// <c>text/calendar</c> part it finds. That is the one thing every variant has in common.
/// </summary>
public static class MimeCalendarExtractor
{
    /// <summary>
    /// Returns the decoded iCalendar text, or null when the message carries none.
    /// </summary>
    public static string? Extract(string? mime)
    {
        if (string.IsNullOrWhiteSpace(mime))
        {
            return null;
        }

        var lines = mime.Replace("\r\n", "\n").Split('\n');

        for (var i = 0; i < lines.Length; i++)
        {
            if (!IsCalendarContentType(lines[i]))
            {
                continue;
            }

            var encoding = "7bit";
            var cursor = i;

            // Walk the remaining headers of this part until the blank line that ends them.
            // Header values may fold onto continuation lines, which start with whitespace.
            while (++cursor < lines.Length && lines[cursor].Trim().Length > 0)
            {
                var line = lines[cursor];

                if (line.StartsWith("Content-Transfer-Encoding:", StringComparison.OrdinalIgnoreCase))
                {
                    encoding = line[(line.IndexOf(':') + 1)..].Trim();
                }
            }

            var body = new StringBuilder();

            // The part ends at the next MIME boundary delimiter, or at the end of the message.
            while (++cursor < lines.Length)
            {
                var line = lines[cursor];

                if (line.StartsWith("--", StringComparison.Ordinal) && line.Trim().Length > 2)
                {
                    break;
                }

                body.Append(line).Append('\n');
            }

            var decoded = Decode(body.ToString(), encoding);

            // A payload without BEGIN:VCALENDAR is not what we were looking for; keep scanning in
            // case the message nests several parts.
            if (decoded is not null && decoded.Contains("BEGIN:VCALENDAR", StringComparison.OrdinalIgnoreCase))
            {
                return decoded;
            }
        }

        return null;
    }

    private static bool IsCalendarContentType(string line)
    {
        return line.StartsWith("Content-Type:", StringComparison.OrdinalIgnoreCase)
            && line.Contains("text/calendar", StringComparison.OrdinalIgnoreCase);
    }

    private static string? Decode(string body, string encoding)
    {
        if (encoding.Equals("base64", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var compact = new string(body.Where(c => !char.IsWhiteSpace(c)).ToArray());
                return Encoding.UTF8.GetString(Convert.FromBase64String(compact));
            }
            catch (FormatException)
            {
                return null;
            }
        }

        if (encoding.Equals("quoted-printable", StringComparison.OrdinalIgnoreCase))
        {
            return DecodeQuotedPrintable(body);
        }

        return body;
    }

    private static string DecodeQuotedPrintable(string body)
    {
        var bytes = new List<byte>();

        // Soft line breaks ("=" at end of line) join the following line without emitting anything.
        foreach (var rawLine in body.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            var soft = line.EndsWith('=');

            if (soft)
            {
                line = line[..^1];
            }

            for (var i = 0; i < line.Length; i++)
            {
                if (line[i] == '=' && i + 2 < line.Length
                    && Uri.IsHexDigit(line[i + 1]) && Uri.IsHexDigit(line[i + 2]))
                {
                    bytes.Add(Convert.ToByte(line.Substring(i + 1, 2), 16));
                    i += 2;
                }
                else
                {
                    bytes.Add((byte)line[i]);
                }
            }

            if (!soft)
            {
                bytes.Add((byte)'\n');
            }
        }

        return Encoding.UTF8.GetString(bytes.ToArray());
    }
}
