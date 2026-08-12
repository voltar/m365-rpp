using System.Net.Http;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;
using Moq;
using RppWebApi.Controllers;
using RppWebApi.Models;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>
/// EO-424: every mailbox-sync route is tenant-wide administration - it exposes other people's
/// absence data and can drive Graph calls against the shared mailbox. The controller documented
/// an app-admin restriction but carried only [Authorize], which merely proves the caller is
/// signed in. These tests pin the actual rule.
/// </summary>
public class MailboxSyncControllerAuthorizationTests
{
    private const string TeamsAdministratorRoleTemplateId = "69091246-20e8-4a56-aa4d-066075b2a7a8";

    [Fact]
    public void GetStatus_ReturnsForbid_ForSignedInUserWithoutAppAdminRole()
    {
        var controller = CreateController(userObjectId: "regular-user", roleTemplateId: null);

        var result = controller.GetStatus();

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public async Task TriggerSync_ReturnsForbid_ForSignedInUserWithoutAppAdminRole()
    {
        var controller = CreateController(userObjectId: "regular-user", roleTemplateId: null);

        var result = await controller.TriggerSync(CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public void GetLog_ReturnsForbid_ForSignedInUserWithoutAppAdminRole()
    {
        var controller = CreateController(userObjectId: "regular-user", roleTemplateId: null);

        var result = controller.GetLog();

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public void GetStatus_ReturnsOk_ForAppAdminDirectoryRole()
    {
        var controller = CreateController(
            userObjectId: "admin-user",
            roleTemplateId: TeamsAdministratorRoleTemplateId);

        var result = controller.GetStatus();

        Assert.IsType<OkObjectResult>(result.Result);
    }

    /// <summary>
    /// The service is transient (typed HttpClient), so run state lives in the singleton.
    /// Without it a scheduled cycle could never be reported, and the "already running" guard
    /// could not see a run started by another instance.
    /// </summary>
    [Fact]
    public void SyncState_RejectsASecondConcurrentRun_AndReportsTheCompletedCycle()
    {
        var state = new MailboxSyncState();

        Assert.True(state.TryBeginRun());
        Assert.False(state.TryBeginRun());
        Assert.True(state.IsRunning);

        state.CompleteRun(new MailboxSyncService.SyncResult
        {
            StartedAt = DateTime.UtcNow,
            CompletedAt = DateTime.UtcNow,
            AbsencesCreated = 2
        });

        Assert.False(state.IsRunning);
        Assert.Equal(2, state.Last?.AbsencesCreated);
        Assert.Single(state.RecentCycles());
        Assert.True(state.TryBeginRun());
    }

    [Fact]
    public void SyncState_KeepsHistoryBounded_NewestFirst()
    {
        var state = new MailboxSyncState();

        for (var i = 0; i < MailboxSyncState.MaxRetainedCycles + 5; i++)
        {
            state.TryBeginRun();
            state.CompleteRun(new MailboxSyncService.SyncResult
            {
                StartedAt = DateTime.UtcNow,
                CompletedAt = DateTime.UtcNow,
                MessagesProcessed = i
            });
        }

        var cycles = state.RecentCycles();

        Assert.Equal(MailboxSyncState.MaxRetainedCycles, cycles.Count);
        Assert.Equal(MailboxSyncState.MaxRetainedCycles + 4, cycles[0].MessagesProcessed);
    }

    private static MailboxSyncController CreateController(string userObjectId, string? roleTemplateId)
    {
        var repository = new Mock<IPlanningRepository>();
        var state = new MailboxSyncState();

        var syncService = new MailboxSyncService(
            new HttpClient(),
            new Mock<ITokenAcquisition>().Object,
            Options.Create(new MailboxSyncSettings { Enabled = false }),
            repository.Object,
            state,
            NullLogger<MailboxSyncService>.Instance);

        var controller = new MailboxSyncController(
            syncService,
            state,
            repository.Object,
            Options.Create(new AppAdminSettings()),
            NullLogger<MailboxSyncController>.Instance);

        var claims = new List<Claim> { new("oid", userObjectId) };

        if (!string.IsNullOrWhiteSpace(roleTemplateId))
        {
            claims.Add(new Claim("wids", roleTemplateId));
        }

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
            }
        };

        return controller;
    }
}
