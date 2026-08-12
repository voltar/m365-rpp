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

/// <summary>Empty primaryTeamId patches must delete host-scoped member assignments.</summary>
public class TeamAdminMemberRemoveTests
{
    [Fact]
    public async Task SaveTeamAdminChanges_EmptyPrimary_RemovesHostAssignments()
    {
        await using var db = CreateDb();
        db.Teams.Add(new TeamAdminTeam
        {
            TeamId = "team-a",
            TeamName = "Alle - Demo",
            OwningTeamId = "m365-host",
            SortOrder = 1,
            CanManage = true,
            Settings = new TeamAdminSettings { TeamId = "team-a" }
        });
        db.MemberAssignments.AddRange(
            new TeamAdminMemberAssignment
            {
                UserId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                TeamId = "team-a",
                IsPrimary = true,
                EmploymentPercentage = 100,
                VacationBalance = 25
            },
            new TeamAdminMemberAssignment
            {
                UserId = "keeper-user",
                TeamId = "team-a",
                IsPrimary = true,
                EmploymentPercentage = 100,
                VacationBalance = 25
            });
        await db.SaveChangesAsync();

        var graph = new StubGraphService(
        [
            GraphMember("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "Orphan Person"),
            GraphMember("keeper-user", "Keeper")
        ]);
        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        var details = await repository.SaveTeamAdminChangesAsync(
            new TeamAdminSaveRequestDto
            {
                TeamId = "team-a",
                MemberAssignments =
                [
                    new TeamAdminMemberAssignmentPatchDto
                    {
                        UserId = "keeper-user",
                        PrimaryTeamId = "team-a",
                        AdditionalTeamIds = [],
                        EmploymentPercentage = 100,
                        VacationBalance = 25
                    },
                    // Remove: empty primary + no additional teams.
                    new TeamAdminMemberAssignmentPatchDto
                    {
                        UserId = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
                        PrimaryTeamId = "",
                        AdditionalTeamIds = []
                    }
                ]
            },
            owningTeamId: "m365-host");

        Assert.DoesNotContain(details.Members, member =>
            string.Equals(member.UserId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(details.Members, member => member.UserId == "keeper-user");
        Assert.Equal(1, await db.MemberAssignments.CountAsync());
        Assert.Equal("keeper-user", (await db.MemberAssignments.SingleAsync()).UserId);
    }

    [Fact]
    public async Task RemoveMemberFromHost_DeletesOrphanGuidAssignment()
    {
        await using var db = CreateDb();
        db.Teams.Add(new TeamAdminTeam
        {
            TeamId = "team-a",
            TeamName = "Alle - Demo",
            OwningTeamId = "m365-host",
            SortOrder = 1,
            CanManage = true,
            Settings = new TeamAdminSettings { TeamId = "team-a" }
        });
        db.MemberAssignments.Add(new TeamAdminMemberAssignment
        {
            UserId = "DEADBEEF-0000-0000-0000-000000000001",
            TeamId = "team-a",
            IsPrimary = true
        });
        await db.SaveChangesAsync();

        var repository = new EfPlanningRepository(
            db,
            new StubGraphService([]),
            NullLogger<EfPlanningRepository>.Instance);

        var removed = await repository.RemoveMemberFromHostAsync(
            "{deadbeef-0000-0000-0000-000000000001}",
            owningTeamId: "m365-host");

        Assert.Equal(1, removed);
        Assert.Equal(0, await db.MemberAssignments.CountAsync());
    }

    [Fact]
    public async Task GetTeamAdminDetails_ExcludesGraphMembersWithoutAssignment()
    {
        await using var db = CreateDb();
        db.Teams.Add(new TeamAdminTeam
        {
            TeamId = "team-a",
            TeamName = "Alle - Demo",
            OwningTeamId = "m365-host",
            SortOrder = 1,
            CanManage = true,
            Settings = new TeamAdminSettings { TeamId = "team-a" }
        });
        db.MemberAssignments.Add(new TeamAdminMemberAssignment
        {
            UserId = "assigned-user",
            TeamId = "team-a",
            IsPrimary = true,
            EmploymentPercentage = 100,
            VacationBalance = 25
        });
        await db.SaveChangesAsync();

        var graph = new StubGraphService(
        [
            GraphMember("assigned-user", "Assigned"),
            GraphMember("graph-only-user", "Graph Only")
        ]);
        var repository = new EfPlanningRepository(db, graph, NullLogger<EfPlanningRepository>.Instance);

        var details = await repository.GetTeamAdminDetailsAsync("team-a", owningTeamId: "m365-host");

        Assert.Single(details.Members);
        Assert.Equal("assigned-user", details.Members[0].UserId);
        Assert.Contains(details.AssignableMembers, member => member.UserId == "graph-only-user");
    }

    private static RppDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<RppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        var db = new RppDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    private static TeamMembershipDto GraphMember(string id, string displayName) => new()
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
            Initials = "XX"
        }
    };

    private sealed class StubGraphService : GraphTeamMembershipService
    {
        public StubGraphService(List<TeamMembershipDto> members)
            : base(
                new Mock<ITokenAcquisition>().Object,
                Options.Create(new GraphSettings()),
                NullLogger<GraphTeamMembershipService>.Instance)
        {
            Members = members;
        }

        private List<TeamMembershipDto> Members { get; }

        public override Task<List<TeamMembershipDto>> GetRealTeamMembersAsync(string? teamId = null, bool throwOnFailure = false)
        {
            return Task.FromResult(Members);
        }

        public override Task<string?> GetTeamDisplayNameAsync(string? teamId)
        {
            return Task.FromResult<string?>("Demo");
        }
    }
}
