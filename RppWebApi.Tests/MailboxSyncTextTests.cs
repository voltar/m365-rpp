using System;
using Microsoft.EntityFrameworkCore;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>
/// EO-424: the two text defects found during acceptance on 2026-07-31. Every absence creation
/// failed with "An error occurred while saving the entity changes. See the inner exception for
/// details." — an unclamped DESCRIPTION hit nvarchar(500), and the message that would have named
/// the cause was thrown away.
/// </summary>
public class MailboxSyncTextTests
{
    [Fact]
    public void Clamp_LeavesShortValueUntouched()
    {
        Assert.Equal("Ferien", MailboxSyncText.Clamp("Ferien", 500));
    }

    [Fact]
    public void Clamp_PassesNullThrough()
    {
        // A missing DESCRIPTION is normal and must stay null rather than become "".
        Assert.Null(MailboxSyncText.Clamp(null, 500));
    }

    [Fact]
    public void Clamp_KeepsValueAtExactlyTheLimit()
    {
        var value = new string('x', 500);

        Assert.Equal(value, MailboxSyncText.Clamp(value, 500));
    }

    [Fact]
    public void Clamp_ShortensAnOversizedDescriptionToTheColumnWidth()
    {
        // What a forwarded invitation actually delivers once joining links and quoted text are
        // appended: far past the column, and previously fatal for the whole message.
        var description = new string('a', 2000);

        var clamped = MailboxSyncText.Clamp(description, MailboxSyncText.CommentMaxLength);

        Assert.Equal(MailboxSyncText.CommentMaxLength, clamped!.Length);
    }

    [Fact]
    public void Clamp_IsDeterministicSoATruncatedUidStillMatchesLater()
    {
        var uid = new string('u', 400);

        var first = MailboxSyncText.Clamp(uid, MailboxSyncText.IcsUidMaxLength);
        var second = MailboxSyncText.Clamp(uid, MailboxSyncText.IcsUidMaxLength);

        Assert.Equal(first, second);
    }

    [Fact]
    public void Describe_NamesTheInnerCauseOfADbUpdateException()
    {
        // The exact shape that made acceptance impossible to diagnose.
        var inner = new Exception("String or binary data would be truncated in table 'Absences', column 'Comment'.");
        var outer = new DbUpdateException(
            "An error occurred while saving the entity changes. See the inner exception for details.",
            inner);

        var described = MailboxSyncText.Describe(outer);

        Assert.Contains("column 'Comment'", described);
        Assert.Contains("See the inner exception", described);
    }

    [Fact]
    public void Describe_WalksTheWholeChain()
    {
        var exception = new Exception("outer", new Exception("middle", new Exception("root cause")));

        Assert.Equal("outer → middle → root cause", MailboxSyncText.Describe(exception));
    }

    [Fact]
    public void Describe_SaysARepeatedMessageOnce()
    {
        var exception = new Exception("same", new Exception("same"));

        Assert.Equal("same", MailboxSyncText.Describe(exception));
    }

    [Fact]
    public void Describe_HandlesAnExceptionWithoutInnerException()
    {
        Assert.Equal("alone", MailboxSyncText.Describe(new Exception("alone")));
    }
}
