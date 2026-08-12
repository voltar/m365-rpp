namespace RppWebApi.Services;

/// <summary>
/// EO-428: Microsoft Graph could not answer — an outage, a throttle, a missing permission on the
/// group.
///
/// It exists so that "we could not ask" stops arriving as "there is nothing". Returning an empty
/// list for a failed lookup made a permission problem indistinguishable from an empty team, and the
/// user was told "no plannable people found" while the actual cause was infrastructure. The same
/// shape of defect had already cost an hour on a swallowed HTTP 403 in the mailbox sync.
/// </summary>
public class GraphUnavailableException : Exception
{
    public GraphUnavailableException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
