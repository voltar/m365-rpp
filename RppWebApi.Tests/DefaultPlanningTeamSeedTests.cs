using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;
using Moq;
using RppWebApi.Data;
using RppWebApi.Models;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>EO-456: first-use default planning team seed.</summary>
public class DefaultPlanningTeamSeedTests
{
    [Fact]
    public void BuildDefaultTeamName_UsesAllePrefixAndDisplayName()
    {
        var name = EfPlanningRepository.BuildDefaultTeamName("  IT   Platform  ", "host-1");
        Assert.Equal("Alle - IT Platform", name);
    }

    [Fact]
    public void BuildDefaultTeamName_FallsBackToHostSuffix_WhenDisplayNameMissing()
    {
        var name = EfPlanningRepository.BuildDefaultTeamName(null, "abcdefghijklmnop");
        Assert.Equal("Alle - Team ijklmnop", name);
    }

    [Fact]
    public async Task GetTeamMemberships_SeedsDefaultTeam_WhenHostHasNoStructures()
    {
        await using var db = CreateDb();
        var graph = new SeedGraphService(
            members:
            [
                Member("user-1", "Ada Lovelace", isGuest: false),
                Member("user-2", "Guest User", isGuest: true)
            ],
            displayName: "IT Platform Services");

        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        var result = await repository.GetTeamMembershipsAsync(teamId: "m365-host-a");

        var teams = await db.Teams.ToListAsync();
        Assert.Single(teams);
        Assert.Equal("Alle - IT Platform Services", teams[0].TeamName);
        Assert.Equal("m365-host-a", teams[0].OwningTeamId);

        var assignments = await db.MemberAssignments.ToListAsync();
        Assert.Equal(2, assignments.Count);
        Assert.All(assignments, row => Assert.True(row.IsPrimary));
        Assert.Contains(assignments, row => row.UserId == "user-1");
        Assert.Contains(assignments, row => row.UserId == "user-2");

        Assert.Equal(2, result.TotalCount);
        Assert.All(result.Items, item => Assert.Equal(teams[0].TeamId, item.TeamId));
    }

    [Fact]
    public async Task GetTeamMemberships_SeedsNonPrimary_WhenUserAlreadyHasPrimaryElsewhere()
    {
        await using var db = CreateDb();
        db.Teams.Add(new TeamAdminTeam
        {
            TeamId = "other-host-team",
            TeamName = "Other Host Team",
            OwningTeamId = "m365-host-other",
            SortOrder = 1,
            Settings = new TeamAdminSettings { TeamId = "other-host-team" }
        });
        db.MemberAssignments.Add(new TeamAdminMemberAssignment
        {
            UserId = "user-1",
            TeamId = "other-host-team",
            IsPrimary = true
        });
        await db.SaveChangesAsync();

        var graph = new SeedGraphService(
            members:
            [
                Member("user-1", "Ada Lovelace", isGuest: false),
                Member("user-2", "Grace Hopper", isGuest: false)
            ],
            displayName: "RPP-Seeding");
        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        var result = await repository.GetTeamMembershipsAsync(teamId: "m365-host-a");

        Assert.Equal(2, await db.Teams.CountAsync());
        var seeded = await db.Teams.SingleAsync(team => team.OwningTeamId == "m365-host-a");
        Assert.Equal("Alle - RPP-Seeding", seeded.TeamName);

        var seededAssignments = await db.MemberAssignments
            .Where(row => row.TeamId == seeded.TeamId)
            .ToListAsync();
        Assert.Equal(2, seededAssignments.Count);
        Assert.False(seededAssignments.Single(row => row.UserId == "user-1").IsPrimary);
        Assert.True(seededAssignments.Single(row => row.UserId == "user-2").IsPrimary);
        Assert.Equal(2, result.TotalCount);
    }

    [Fact]
    public async Task GetTeamMemberships_DoesNotSeed_WhenHostAlreadyHasInternalTeam()
    {
        await using var db = CreateDb();
        db.Teams.Add(new TeamAdminTeam
        {
            TeamId = "existing",
            TeamName = "Existing Structure",
            OwningTeamId = "m365-host-a",
            SortOrder = 1,
            Settings = new TeamAdminSettings { TeamId = "existing" }
        });
        db.MemberAssignments.Add(new TeamAdminMemberAssignment
        {
            UserId = "only-one",
            TeamId = "existing",
            IsPrimary = true
        });
        await db.SaveChangesAsync();

        var graph = new SeedGraphService(
            members: [Member("user-1", "New Person", isGuest: false)],
            displayName: "IT Platform Services");
        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        var result = await repository.GetTeamMembershipsAsync(teamId: "m365-host-a");

        Assert.Equal(1, await db.Teams.CountAsync());
        Assert.Equal("Existing Structure", (await db.Teams.SingleAsync()).TeamName);
        Assert.Single(result.Items);
        Assert.Equal("only-one", result.Items[0].Member.Id);
    }

    [Fact]
    public async Task GetTeamMemberships_DoesNotCreateStickyEmptyTeam_WhenGraphUnavailable()
    {
        await using var db = CreateDb();
        var graph = new SeedGraphService(members: [], displayName: "IT Platform Services")
        {
            GraphUnavailable = true
        };
        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        var result = await repository.GetTeamMembershipsAsync(teamId: "m365-host-a");

        Assert.Empty(await db.Teams.ToListAsync());
        Assert.Empty(result.Items);

        // Recovery: Graph comes back — seed succeeds on the next request.
        graph.GraphUnavailable = false;
        graph.Members =
        [
            Member("user-1", "Ada", isGuest: false)
        ];

        result = await repository.GetTeamMembershipsAsync(teamId: "m365-host-a");

        Assert.Single(await db.Teams.ToListAsync());
        Assert.Equal("Alle - IT Platform Services", (await db.Teams.SingleAsync()).TeamName);
        Assert.Single(result.Items);
    }

    [Fact]
    public async Task GetTeamMemberships_DoesNotSeed_WithoutHostTeamId()
    {
        await using var db = CreateDb();
        var graph = new SeedGraphService(
            members: [Member("user-1", "Ada", isGuest: false)],
            displayName: "IT Platform Services");
        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        await repository.GetTeamMembershipsAsync(teamId: null);

        Assert.Empty(await db.Teams.ToListAsync());
    }

    [Fact]
    public async Task ConcurrentFirstUse_CreatesSingleDefaultTeam()
    {
        // Separate DbContext instances (as in real requests) sharing one in-memory store.
        var databaseName = Guid.NewGuid().ToString("N");
        await using var dbA = CreateDb(databaseName);
        await using var dbB = CreateDb(databaseName);
        await using var dbAssert = CreateDb(databaseName);

        var graph = new SeedGraphService(
            members:
            [
                Member("user-1", "Ada", isGuest: false),
                Member("user-2", "Grace", isGuest: false)
            ],
            displayName: "Ops")
        {
            FetchDelay = TimeSpan.FromMilliseconds(40)
        };

        var repositoryA = new EfPlanningRepository(dbA, graph, NullLogger<EfPlanningRepository>.Instance);
        var repositoryB = new EfPlanningRepository(dbB, graph, NullLogger<EfPlanningRepository>.Instance);

        // Call the seed helper directly so the race is about default-team creation, not the
        // unrelated org-config seed that also runs inside GetTeamMembershipsAsync.
        await Task.WhenAll(
            repositoryA.EnsureDefaultPlanningTeamAsync("m365-host-race"),
            repositoryB.EnsureDefaultPlanningTeamAsync("m365-host-race"));

        Assert.Equal(1, await dbAssert.Teams.CountAsync(team => team.OwningTeamId == "m365-host-race"));
        Assert.Equal(2, await dbAssert.MemberAssignments.CountAsync());
    }

    private static RppDbContext CreateDb(string? databaseName = null)
    {
        var options = new DbContextOptionsBuilder<RppDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString("N"))
            .Options;
        var db = new RppDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    private static TeamMembershipDto Member(string id, string displayName, bool isGuest) => new()
    {
        Id = $"mship-{id}",
        TeamId = "graph",
        TeamName = "graph",
        IsPrimary = true,
        Member = new TeamMemberDto
        {
            Id = id,
            DisplayName = displayName,
            Mail = $"{id}@example.com",
            Initials = "XX",
            IsGuest = isGuest
        }
    };

    private sealed class SeedGraphService : GraphTeamMembershipService
    {
        public SeedGraphService(List<TeamMembershipDto> members, string? displayName)
            : base(
                new Mock<ITokenAcquisition>().Object,
                Options.Create(new GraphSettings()),
                NullLogger<GraphTeamMembershipService>.Instance)
        {
            Members = members;
            DisplayName = displayName;
        }

        public List<TeamMembershipDto> Members { get; set; }
        public string? DisplayName { get; set; }
        public bool GraphUnavailable { get; set; }
        public TimeSpan FetchDelay { get; set; } = TimeSpan.Zero;

        public override async Task<List<TeamMembershipDto>> GetRealTeamMembersAsync(string? teamId = null, bool throwOnFailure = false)
        {
            if (FetchDelay > TimeSpan.Zero)
            {
                await Task.Delay(FetchDelay);
            }

            if (GraphUnavailable)
            {
                if (throwOnFailure)
                {
                    throw new GraphUnavailableException("Graph is unavailable in this test.", new Exception("test"));
                }

                return [];
            }

            return Members;
        }

        public override Task<string?> GetTeamDisplayNameAsync(string? teamId)
        {
            return Task.FromResult(DisplayName);
        }
    }
}
