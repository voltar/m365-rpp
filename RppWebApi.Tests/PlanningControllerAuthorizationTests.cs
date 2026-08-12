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

public class PlanningControllerAuthorizationTests
{
    [Fact]
    public async Task GetVacationRequests_ReadsGraphStatusesWithBoundedConcurrency()
    {
        var repository = new FakePlanningRepository
        {
            VacationRequests = Enumerable.Range(1, 8)
                .Select(index => new VacationRequestDto
                {
                    Id = $"request-{index}",
                    EmployeeId = "current-user",
                    Status = "pendingApproval",
                    ApprovalReferenceId = $"approval-{index}"
                })
                .ToList()
        };
        var graphApprovals = new Mock<IGraphApprovalService>();
        var concurrencyLock = new object();
        var activeCalls = 0;
        var maximumConcurrency = 0;

        graphApprovals.SetupGet(service => service.IsEnabled).Returns(true);
        graphApprovals
            .Setup(service => service.GetApprovalStatusAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, CancellationToken cancellationToken) =>
            {
                lock (concurrencyLock)
                {
                    activeCalls++;
                    maximumConcurrency = Math.Max(maximumConcurrency, activeCalls);
                }

                try
                {
                    await Task.Delay(25, cancellationToken);
                    return new GraphApprovalStatus { State = "pending" };
                }
                finally
                {
                    lock (concurrencyLock)
                    {
                        activeCalls--;
                    }
                }
            });

        var controller = CreateController(
            repository,
            new FakeGraphTeamMembershipService((_, _) => true),
            "current-user",
            graphApprovalService: graphApprovals.Object);

        await controller.GetVacationRequests();

        Assert.InRange(maximumConcurrency, 1, 4);
        graphApprovals.Verify(
            service => service.GetApprovalStatusAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Exactly(8));
    }

    [Fact]
    public async Task GetTeamAdminDetails_ReturnsForbid_WhenUserIsNotTeamOwner()
    {
        var repository = new FakePlanningRepository();
        repository.TeamDetailsById["team-a"] = BuildDetails("team-a", new TeamAdminMemberDto
        {
            UserId = "current-user",
            PrimaryTeamId = "team-a"
        });

        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => false), "current-user");

        var result = await controller.GetTeamAdminDetails("team-a");

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public async Task GetTeamAdminDetails_ReturnsOk_WhenUserIsTeamOwner()
    {
        var repository = new FakePlanningRepository();
        repository.TeamDetailsById["team-a"] = BuildDetails("team-a", new TeamAdminMemberDto
        {
            UserId = "current-user",
            PrimaryTeamId = "team-a"
        });

        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => true), "current-user");

        var result = await controller.GetTeamAdminDetails("team-a");

        Assert.NotNull(result.Result);
        Assert.IsType<OkObjectResult>(result.Result);
    }

    /// <summary>
    /// EO-428: this test previously expected the two managed teams to come back without any team
    /// context, because the controller fell back to the configured default team. That fallback is
    /// what produced a permission error for a legitimate user in the field, so the expectation
    /// changed with it: no context is now reported, not resolved to a guess.
    /// </summary>
    [Fact]
    public async Task GetManagedTeams_ReportsNoTeamContext_WhenNoTeamContextIsPresent()
    {
        var repository = new FakePlanningRepository();
        repository.ManagedTeams = new PlanningResponse<TeamAdminTeamSummaryDto>
        {
            Items =
            [
                new TeamAdminTeamSummaryDto { TeamId = "team-a", TeamName = "Team A" },
                new TeamAdminTeamSummaryDto { TeamId = "team-b", TeamName = "Team B" }
            ],
            TotalCount = 2
        };

        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => true), "current-user");

        var result = await controller.GetManagedTeams();

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status428PreconditionRequired, response.StatusCode);
        Assert.Contains("noTeamContext", response.Value!.ToString());
    }

    /// <summary>
    /// EO-428: a Graph outage used to answer HTTP 200 with an empty member list, which the UI showed
    /// as "no plannable people found" — infrastructure reported as a fact about the data, and
    /// unreachable from any client-side handling because the response said success.
    /// </summary>
    [Fact]
    public async Task GetTeamMemberships_ReportsAFailure_WhenGraphIsUnavailable()
    {
        var graphService = new FakeGraphTeamMembershipService((_, _) => true) { GraphUnavailable = true };
        var controller = CreateController(new FakePlanningRepository(), graphService, "current-user", "team-a");

        var result = await controller.GetTeamMemberships();

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status502BadGateway, response.StatusCode);
        Assert.Contains("membershipLookupFailed", response.Value!.ToString());
    }

    /// <summary>
    /// EO-428 FR-428.4: guests are never team administrators. The owner check is rigged to say yes
    /// here, so the test fails if the guest rule is ever dropped and the outcome quietly falls back
    /// to whatever Microsoft 365 happens to answer.
    /// </summary>
    [Fact]
    public async Task GetAccess_DeniesTeamOwnership_ForAGuestEvenWhenTheOwnerCheckWouldAllowIt()
    {
        var graphService = new FakeGraphTeamMembershipService((_, _) => true)
        {
            Members =
            [
                new TeamMembershipDto
                {
                    Member = new TeamMemberDto { Id = "current-user", DisplayName = "Guest User", IsGuest = true }
                }
            ]
        };

        var controller = CreateController(new FakePlanningRepository(), graphService, "current-user", "team-a");

        var result = await controller.GetAccess();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var access = Assert.IsType<AccessInfoDto>(ok.Value);

        Assert.True(access.IsGuest);
        Assert.False(access.IsTeamOwner);
    }

    [Fact]
    public async Task GetAccess_GrantsTeamOwnership_ForANonGuestOwner()
    {
        var graphService = new FakeGraphTeamMembershipService((_, _) => true)
        {
            Members =
            [
                new TeamMembershipDto
                {
                    Member = new TeamMemberDto { Id = "current-user", DisplayName = "Member User", IsGuest = false }
                }
            ]
        };

        var controller = CreateController(new FakePlanningRepository(), graphService, "current-user", "team-a");

        var result = await controller.GetAccess();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var access = Assert.IsType<AccessInfoDto>(ok.Value);

        Assert.False(access.IsGuest);
        Assert.True(access.IsTeamOwner);
    }

    /// <summary>
    /// EO-428: the condition must be distinguishable from "forbidden". A caller with a team context
    /// they do not belong to still gets 403 — that is a permission problem and has a different
    /// remedy than a missing selection.
    /// </summary>
    [Fact]
    public async Task GetTeamMemberships_ReportsNoTeamContext_WhenNoTeamContextIsPresent()
    {
        var controller = CreateController(
            new FakePlanningRepository(),
            new FakeGraphTeamMembershipService((_, _) => true),
            "current-user");

        var result = await controller.GetTeamMemberships();

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status428PreconditionRequired, response.StatusCode);
        Assert.Contains("noTeamContext", response.Value!.ToString());
    }

    [Fact]
    public async Task GetManagedTeams_ReturnsAllManagedTeams_WhenUserOwnsActiveHostTeam()
    {
        var repository = new FakePlanningRepository();
        repository.ManagedTeams = new PlanningResponse<TeamAdminTeamSummaryDto>
        {
            Items =
            [
                new TeamAdminTeamSummaryDto { TeamId = "team-a", TeamName = "Team A" },
                new TeamAdminTeamSummaryDto { TeamId = "team-b", TeamName = "Team B" }
            ],
            TotalCount = 2
        };

        var controller = CreateController(
            repository,
            new FakeGraphTeamMembershipService((_, teamId) => string.Equals(teamId, "host-team-a", StringComparison.OrdinalIgnoreCase)),
            "current-user",
            activeTeamId: "host-team-a");

        var result = await controller.GetManagedTeams();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<PlanningResponse<TeamAdminTeamSummaryDto>>(ok.Value);

        Assert.Equal(2, response.Items.Count);
    }

    [Fact]
    public async Task GetVacationRequests_ReturnsOnlyCurrentTeamRequests_WhenTeamIdProvided()
    {
        var repository = new FakePlanningRepository();
        repository.VacationRequests =
        [
            new VacationRequestDto { Id = "req-team-a", EmployeeId = "current-user", TeamId = "team-a", Status = "submitted", Modified = DateTime.UtcNow },
            new VacationRequestDto { Id = "req-team-b", EmployeeId = "current-user", TeamId = "team-b", Status = "submitted", Modified = DateTime.UtcNow }
        ];

        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => true), "current-user");

        var result = await controller.GetVacationRequests(teamId: "team-a", userId: "current-user");

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<PlanningResponse<VacationRequestDto>>(ok.Value);

        Assert.Single(response.Items);
        Assert.Equal("req-team-a", response.Items[0].Id);
    }

    // --- EO-459: team-scoped planning reads + write target membership -----------------

    [Fact]
    public async Task GetAbsences_ReportsNoTeamContext_WhenNoTeamContextIsPresent()
    {
        var controller = CreateController(
            new FakePlanningRepository(),
            CreateMemberGraph("current-user"),
            "current-user");

        var result = await controller.GetAbsences();

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status428PreconditionRequired, response.StatusCode);
        Assert.Contains("noTeamContext", response.Value!.ToString());
    }

    [Fact]
    public async Task GetAbsences_ReturnsForbid_WhenCallerIsNotTeamMember()
    {
        var graph = CreateMemberGraph("someone-else");
        var controller = CreateController(new FakePlanningRepository(), graph, "current-user", activeTeamId: "host-team-a");

        var result = await controller.GetAbsences();

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task GetAbsences_ReturnsOnlyTeamMemberAbsences()
    {
        var repository = new FakePlanningRepository
        {
            Absences =
            [
                new AbsenceDto { Id = "a1", EmployeeId = "current-user", Type = "vacation" },
                new AbsenceDto { Id = "a2", EmployeeId = "teammate", Type = "vacation" },
                new AbsenceDto { Id = "a3", EmployeeId = "outsider", Type = "vacation" }
            ]
        };
        var graph = CreateMemberGraph("current-user", "teammate");
        var controller = CreateController(repository, graph, "current-user", activeTeamId: "host-team-a");

        var result = await controller.GetAbsences();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<PlanningResponse<AbsenceDto>>(ok.Value);
        Assert.Equal(2, response.Items.Count);
        Assert.DoesNotContain(response.Items, item => item.EmployeeId == "outsider");
    }

    [Fact]
    public async Task GetVacationBalances_ReturnsOnlyTeamMemberBalances()
    {
        var repository = new FakePlanningRepository
        {
            VacationBalances =
            [
                new VacationBalanceDto { EmployeeId = "current-user", Year = 2026 },
                new VacationBalanceDto { EmployeeId = "outsider", Year = 2026 }
            ]
        };
        var graph = CreateMemberGraph("current-user");
        var controller = CreateController(repository, graph, "current-user", activeTeamId: "host-team-a");

        var result = await controller.GetVacationBalances();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<PlanningResponse<VacationBalanceDto>>(ok.Value);
        Assert.Single(response.Items);
        Assert.Equal("current-user", response.Items[0].EmployeeId);
    }

    [Fact]
    public async Task GetPlanningEvents_ReturnsOnlyTeamMemberEvents()
    {
        var repository = new FakePlanningRepository
        {
            PlanningEvents =
            [
                new PlanningEventDto { Id = "e1", EmployeeId = "current-user", Type = "training", Title = "A" },
                new PlanningEventDto { Id = "e2", EmployeeId = "outsider", Type = "training", Title = "B" }
            ]
        };
        var graph = CreateMemberGraph("current-user");
        var controller = CreateController(repository, graph, "current-user", activeTeamId: "host-team-a");

        var result = await controller.GetPlanningEvents();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<PlanningResponse<PlanningEventDto>>(ok.Value);
        Assert.Single(response.Items);
        Assert.Equal("e1", response.Items[0].Id);
    }

    [Fact]
    public async Task SaveAbsence_AllowsSelfWithoutTeamContext()
    {
        var repository = new FakePlanningRepository();
        var controller = CreateController(repository, CreateMemberGraph("current-user"), "current-user");

        var result = await controller.SaveAbsence(new AbsenceDto
        {
            Id = "abs-self",
            EmployeeId = "current-user",
            Type = "vacation"
        });

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task SaveAbsence_ReportsNoTeamContext_WhenOwnerWriteHasNoTeam()
    {
        var repository = new FakePlanningRepository();
        // Owner check would pass for any team, but without context owner path must not run.
        var graph = new FakeGraphTeamMembershipService((_, _) => true);
        var controller = CreateController(repository, graph, "current-user");

        var result = await controller.SaveAbsence(new AbsenceDto
        {
            Id = "abs-other",
            EmployeeId = "other-user",
            Type = "vacation"
        });

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status428PreconditionRequired, response.StatusCode);
        Assert.Contains("noTeamContext", response.Value!.ToString());
    }

    [Fact]
    public async Task SaveAbsence_ReturnsForbid_WhenOwnerWritesForNonMember()
    {
        var repository = new FakePlanningRepository();
        var graph = CreateMemberGraph("current-user", "teammate");
        // current-user is owner of host-team-a
        graph = new FakeGraphTeamMembershipService((userId, teamId) =>
            string.Equals(userId, "current-user", StringComparison.OrdinalIgnoreCase)
            && string.Equals(teamId, "host-team-a", StringComparison.OrdinalIgnoreCase))
        {
            Members = CreateMemberGraph("current-user", "teammate").Members
        };

        var controller = CreateController(repository, graph, "current-user", activeTeamId: "host-team-a");

        var result = await controller.SaveAbsence(new AbsenceDto
        {
            Id = "abs-out",
            EmployeeId = "outsider",
            Type = "vacation"
        });

        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SaveAbsence_AllowsOwnerWriteForTeamMember()
    {
        var repository = new FakePlanningRepository();
        var graph = new FakeGraphTeamMembershipService((userId, teamId) =>
            string.Equals(userId, "current-user", StringComparison.OrdinalIgnoreCase)
            && string.Equals(teamId, "host-team-a", StringComparison.OrdinalIgnoreCase))
        {
            Members =
            [
                new TeamMembershipDto { Member = new TeamMemberDto { Id = "current-user" }, TeamId = "host-team-a" },
                new TeamMembershipDto { Member = new TeamMemberDto { Id = "teammate" }, TeamId = "host-team-a" }
            ]
        };
        var controller = CreateController(repository, graph, "current-user", activeTeamId: "host-team-a");

        var result = await controller.SaveAbsence(new AbsenceDto
        {
            Id = "abs-mate",
            EmployeeId = "teammate",
            Type = "vacation"
        });

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task UpdateTeams_ReturnsForbid_WhenUserIsNotTeamOwner()
    {
        var repository = new FakePlanningRepository();
        repository.TeamDetailsById["team-a"] = BuildDetails("team-a", new TeamAdminMemberDto
        {
            UserId = "current-user",
            PrimaryTeamId = "team-a"
        });
        repository.TeamDetailsById["team-b"] = BuildDetails("team-b", new TeamAdminMemberDto
        {
            UserId = "other-user",
            PrimaryTeamId = "team-b"
        });

        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => false), "current-user");

        var request = new TeamsUpdateRequestDto
        {
            Teams =
            [
                new TeamRowDto { TeamId = "team-b", TeamName = "Team B", Organization = "Organisation-A", SortOrder = 1, RequiredStaffing = 1 }
            ]
        };

        var result = await controller.UpdateTeams(request);

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public async Task CreateTeam_ReturnsBadRequest_WhenSourceTeamIdMissing()
    {
        var repository = new FakePlanningRepository();
        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => true), "current-user");

        var result = await controller.CreateTeam(new TeamCreateRequestDto
        {
            TeamName = "New Team",
            Organization = "Organisation-A",
            SourceTeamId = null
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateTeam_ReturnsForbid_WhenUserIsNotM365Owner()
    {
        var repository = new FakePlanningRepository();
        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => false), "current-user");

        var result = await controller.CreateTeam(new TeamCreateRequestDto
        {
            TeamName = "New Team",
            Organization = "Organisation-A",
            SourceTeamId = "m365-team-a"
        });

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public async Task CreateTeam_ReturnsOk_WhenUserIsM365Owner()
    {
        var repository = new FakePlanningRepository();
        var controller = CreateController(repository, new FakeGraphTeamMembershipService((_, _) => true), "current-user");

        var result = await controller.CreateTeam(new TeamCreateRequestDto
        {
            TeamName = "New Team",
            Organization = "Organisation-A",
            SourceTeamId = "m365-team-a"
        });

        Assert.NotNull(result.Result);
        Assert.IsType<OkObjectResult>(result.Result);
    }

    private static TeamAdminDetailsDto BuildDetails(string teamId, params TeamAdminMemberDto[] members)
    {
        return new TeamAdminDetailsDto
        {
            Team = new TeamAdminTeamSummaryDto { TeamId = teamId, TeamName = teamId },
            Members = members.ToList()
        };
    }

    private static FakeGraphTeamMembershipService CreateMemberGraph(params string[] memberIds)
    {
        return new FakeGraphTeamMembershipService((_, _) => false)
        {
            Members = memberIds
                .Select(id => new TeamMembershipDto
                {
                    Member = new TeamMemberDto { Id = id },
                    TeamId = "host-team-a"
                })
                .ToList()
        };
    }

    private static PlanningController CreateController(
        FakePlanningRepository repository,
        GraphTeamMembershipService graphService,
        string userId,
        string? activeTeamId = null,
        IGraphApprovalService? graphApprovalService = null)
    {
        var tokenMock = new Mock<ITokenAcquisition>();

        var approvalFlow = new ApprovalFlowService(
            new HttpClient(),
            Options.Create(new ApprovalFlowSettings { Enabled = false }),
            NullLogger<ApprovalFlowService>.Instance);

        var graphApproval = graphApprovalService ?? new GraphApprovalService(
            new HttpClient(),
            tokenMock.Object,
            Options.Create(new GraphApprovalSettings { Enabled = false }),
            NullLogger<GraphApprovalService>.Instance);

        var outlookSync = new OutlookCalendarSyncService(
            new HttpClient(),
            tokenMock.Object,
            Options.Create(new OutlookSyncSettings { Enabled = false }),
            NullLogger<OutlookCalendarSyncService>.Instance);

        var userPhotos = new UserPhotoService(
            new HttpClient(),
            tokenMock.Object,
            NullLogger<UserPhotoService>.Instance);

        var controller = new PlanningController(
            repository,
            graphService,
            approvalFlow,
            graphApproval,
            outlookSync,
            userPhotos,
            Options.Create(new AppAdminSettings()),
            Options.Create(new GraphSettings { TeamGroupId = "default-team", TeamName = "Default Team" }),
            NullLogger<PlanningController>.Instance);

        var claims = new List<Claim>
        {
            new("oid", userId),
            new(ClaimTypes.NameIdentifier, userId)
        };

        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
        };

        if (!string.IsNullOrWhiteSpace(activeTeamId))
        {
            httpContext.Request.Headers["X-RPP-Active-TeamId"] = activeTeamId;
        }

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = httpContext
        };

        return controller;
    }

    private sealed class FakeGraphTeamMembershipService : GraphTeamMembershipService
    {
        private readonly Func<string, string?, bool> _ownerCheck;

        public FakeGraphTeamMembershipService(Func<string, string?, bool> ownerCheck)
            : base(
                new Mock<ITokenAcquisition>().Object,
                Options.Create(new GraphSettings { TeamGroupId = "default-team", TeamName = "Default Team" }),
                NullLogger<GraphTeamMembershipService>.Instance)
        {
            _ownerCheck = ownerCheck;
        }

        public override Task<bool> IsUserOwnerOfTeamAsync(string userId, string? teamId = null)
        {
            return Task.FromResult(_ownerCheck(userId, teamId));
        }

        /// <summary>Members the fake team reports. Empty unless a test needs a specific one.</summary>
        public List<TeamMembershipDto> Members { get; set; } = new();

        /// <summary>When set, the fake behaves like Graph being unreachable (EO-428).</summary>
        public bool GraphUnavailable { get; set; }

        public override Task<List<TeamMembershipDto>> GetRealTeamMembersAsync(string? teamId = null, bool throwOnFailure = false)
        {
            if (GraphUnavailable && throwOnFailure)
            {
                throw new GraphUnavailableException("Graph is unavailable in this test.", new Exception("test"));
            }

            return Task.FromResult(GraphUnavailable ? new List<TeamMembershipDto>() : Members);
        }
    }

    private sealed class FakePlanningRepository : IPlanningRepository
    {
        public Dictionary<string, TeamAdminDetailsDto> TeamDetailsById { get; } = new(StringComparer.OrdinalIgnoreCase);

        public PlanningResponse<TeamMembershipDto> TeamMemberships { get; set; } = new();

        public PlanningResponse<TeamAdminTeamSummaryDto> ManagedTeams { get; set; } = new();

        public List<VacationRequestDto> VacationRequests { get; set; } = new();

        public List<AbsenceDto> Absences { get; set; } = new();

        public List<VacationBalanceDto> VacationBalances { get; set; } = new();

        public List<PlanningEventDto> PlanningEvents { get; set; } = new();

        public Task<PlanningResponse<AbsenceDto>> GetAbsencesAsync(string? employeeId = null, int? year = null, string? status = null)
        {
            var items = Absences
                .Where(item => employeeId == null || item.EmployeeId == employeeId)
                .Where(item => status == null || item.Status == status)
                .ToList();
            return Task.FromResult(new PlanningResponse<AbsenceDto> { Items = items, TotalCount = items.Count });
        }

        public Task<AbsenceDto?> GetAbsenceByIcsUidAsync(string icsUid) => Task.FromResult<AbsenceDto?>(null);

        public Task<List<AbsenceDto>> GetAbsencesByEmployeeAndDateRangeAsync(string employeeId, DateTime startDate, DateTime endDate)
            => Task.FromResult(new List<AbsenceDto>());

        public Task<AbsenceDto> SaveAbsenceAsync(AbsenceDto absence) => Task.FromResult(absence);

        public Task DeleteAbsenceAsync(string id) => Task.CompletedTask;

        public Task<PlanningResponse<VacationBalanceDto>> GetVacationBalancesAsync(string? employeeId = null, int? year = null)
        {
            var items = VacationBalances
                .Where(item => employeeId == null || item.EmployeeId == employeeId)
                .Where(item => year == null || item.Year == year)
                .ToList();
            return Task.FromResult(new PlanningResponse<VacationBalanceDto> { Items = items, TotalCount = items.Count });
        }

        public Task<PlanningResponse<PlanningEventDto>> GetPlanningEventsAsync(string? employeeId = null)
        {
            var items = PlanningEvents
                .Where(item => employeeId == null || item.EmployeeId == employeeId)
                .ToList();
            return Task.FromResult(new PlanningResponse<PlanningEventDto> { Items = items, TotalCount = items.Count });
        }

        public Task<object> GetPlanningSettingsAsync() => Task.FromResult<object>(new { });

        public Task<PlanningResponse<object>> GetTeamConfigurationsAsync() => Task.FromResult(new PlanningResponse<object>());

        public Task<PlanningResponse<VacationRequestDto>> GetVacationRequestsAsync(string? status = null, string? userId = null, string? requestId = null, string? teamId = null)
        {
            var items = VacationRequests
                .Where(request => requestId == null || request.Id == requestId)
                .Where(request => userId == null || request.EmployeeId == userId)
                .Where(request => teamId == null || request.TeamId == teamId)
                .Where(request => status == null || request.Status == status)
                .OrderByDescending(request => request.Modified)
                .ToList();

            return Task.FromResult(new PlanningResponse<VacationRequestDto>
            {
                Items = items,
                TotalCount = items.Count
            });
        }

        public Task<VacationRequestDto> SaveVacationRequestAsync(VacationRequestDto request) => Task.FromResult(request);

        public Task DeleteVacationRequestAsync(string id) => Task.CompletedTask;

        public Task<VacationRequestDto?> ApplyApprovalDecisionAsync(ApprovalCallbackDto callback)
            => Task.FromResult<VacationRequestDto?>(null);

        public Task<ApprovalOptionsDto> GetApprovalOptionsAsync(
            string owningTeamId,
            string? employeeId,
            IReadOnlyCollection<TeamMembershipDto> graphMembers)
        {
            var candidates = graphMembers
                .Where(member => !string.IsNullOrWhiteSpace(member.Member.Id))
                .Where(member =>
                    string.IsNullOrWhiteSpace(employeeId)
                    || !string.Equals(member.Member.Id, employeeId, StringComparison.OrdinalIgnoreCase))
                .Select(member => new ApprovalCandidateDto
                {
                    UserId = member.Member.Id,
                    DisplayName = member.Member.DisplayName
                })
                .ToList();

            return Task.FromResult(new ApprovalOptionsDto
            {
                DefaultApproverUserId = candidates.FirstOrDefault()?.UserId,
                AllowOverride = true,
                Candidates = candidates
            });
        }

        public Task<IReadOnlyList<string>> ListAssignedUserIdsAsync() =>
            Task.FromResult<IReadOnlyList<string>>(
                TeamMemberships.Items
                    .Select(item => item.Member.Id)
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList());

        public Task<PlanningResponse<TeamMembershipDto>> GetTeamMembershipsAsync(string? pageToken = null, string? teamId = null)
        {
            var items = TeamMemberships.Items;
            if (!string.IsNullOrWhiteSpace(teamId))
            {
                items = items.Where(row => string.Equals(row.TeamId, teamId, StringComparison.OrdinalIgnoreCase)).ToList();
            }

            return Task.FromResult(new PlanningResponse<TeamMembershipDto>
            {
                Items = items.ToList(),
                TotalCount = items.Count
            });
        }

        public Task<OrgConfigDto> GetOrgConfigAsync() => Task.FromResult(new OrgConfigDto());

        public Task<OrgConfigDto> SaveOrgConfigAsync(OrgConfigPatchDto patch) => Task.FromResult(new OrgConfigDto());

        public Task<DisplayConfigDto> GetDisplayConfigAsync() => Task.FromResult(new DisplayConfigDto());

        public Task<DisplayConfigDto> SaveDisplayConfigAsync(DisplayConfigPatchDto patch)
            => Task.FromResult(new DisplayConfigDto { ShowVacationSummary = patch.ShowVacationSummary ?? true });

        public Task<MailboxSyncConfigDto> GetMailboxSyncConfigAsync() => Task.FromResult(new MailboxSyncConfigDto());

        public Task<MailboxSyncConfigDto> SaveMailboxSyncConfigAsync(MailboxSyncConfigPatchDto patch)
            => Task.FromResult(new MailboxSyncConfigDto { MailboxAddress = patch.MailboxAddress?.Trim() ?? string.Empty });

        public Task<PlanningResponse<PublicHoliday>> GetPublicHolidaysAsync() => Task.FromResult(new PlanningResponse<PublicHoliday>());

        public Task<PlanningResponse<PublicHoliday>> ReplacePublicHolidaysAsync(IReadOnlyCollection<PublicHoliday> holidays)
            => Task.FromResult(new PlanningResponse<PublicHoliday>());

        // EO-419/EO-420: the owningTeamId is the M365 host-group id; the fake ignores
        // host scoping and serves its configured data directly.
        public Task<PlanningResponse<TeamAdminTeamSummaryDto>> GetManagedTeamsAsync(string? owningTeamId = null)
            => Task.FromResult(ManagedTeams);

        public Task<TeamAdminDetailsDto> GetTeamAdminDetailsAsync(string teamId, string? owningTeamId = null)
        {
            if (TeamDetailsById.TryGetValue(teamId, out var details))
            {
                return Task.FromResult(details);
            }

            throw new KeyNotFoundException($"Team {teamId} was not found.");
        }

        public Task<TeamAdminDetailsDto> SaveTeamAdminChangesAsync(TeamAdminSaveRequestDto saveRequest, string? owningTeamId = null)
            => GetTeamAdminDetailsAsync(saveRequest.TeamId);

        public Task<int> RemoveMemberFromHostAsync(string userId, string? owningTeamId = null)
            => Task.FromResult(0);

        public Task<TeamAdminTeamSummaryDto> CreateTeamAsync(TeamCreateRequestDto request)
            => Task.FromResult(new TeamAdminTeamSummaryDto { TeamId = "new-team", TeamName = request.TeamName });

        public Task<PlanningResponse<TeamAdminTeamSummaryDto>> UpdateTeamsAsync(TeamsUpdateRequestDto request, string? owningTeamId = null)
            => Task.FromResult(new PlanningResponse<TeamAdminTeamSummaryDto>());

        public Task DeleteTeamAsync(string teamId, string? owningTeamId = null) => Task.CompletedTask;

        // EO-454: Holiday calendar slot configuration
        public Task<IReadOnlyCollection<HolidayCalendarSlot>> GetHolidayCalendarSlotsAsync(string teamId)
            => Task.FromResult<IReadOnlyCollection<HolidayCalendarSlot>>(new List<HolidayCalendarSlot>());

        public Task<IReadOnlyCollection<HolidayCalendarSlot>> UpdateHolidayCalendarSlotsAsync(string teamId, IReadOnlyCollection<HolidayCalendarSlot> slots)
            => Task.FromResult(slots);
    }
}
