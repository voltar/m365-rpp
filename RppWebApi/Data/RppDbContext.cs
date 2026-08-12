using Microsoft.EntityFrameworkCore;
using RppWebApi.Models;

namespace RppWebApi.Data;

/// <summary>
/// EF Core DbContext for RPP planning data.
/// Maps to the SharePoint-inspired schema defined in the frontend (EO-101).
/// </summary>
public class RppDbContext : DbContext
{
    public RppDbContext(DbContextOptions<RppDbContext> options)
        : base(options)
    {
    }

    public DbSet<AbsenceDto> Absences { get; set; } = null!;
    public DbSet<VacationBalanceDto> VacationBalances { get; set; } = null!;
    public DbSet<PlanningEventDto> PlanningEvents { get; set; } = null!;
    public DbSet<VacationRequestDto> VacationRequests { get; set; } = null!;
    public DbSet<TeamConfiguration> TeamConfigurations { get; set; } = null!;

    // EO-408: Normalized Team Admin persistence (replaces localStorage)
    public DbSet<TeamAdminTeam> Teams { get; set; } = null!;
    public DbSet<TeamAdminMemberAssignment> MemberAssignments { get; set; } = null!;
    public DbSet<TeamAdminSettings> TeamSettings { get; set; } = null!;
    public DbSet<TeamAdminAbsenceType> AbsenceEntryTypes { get; set; } = null!;

    // EO-415: configurable organisations, locations and Graph profile value mappings
    public DbSet<PlanningOrganisation> Organisations { get; set; } = null!;
    public DbSet<PlanningLocation> Locations { get; set; } = null!;
    public DbSet<ProfileValueMapping> ProfileValueMappings { get; set; } = null!;

    // EO-416: persisted holiday calendar (public + school holidays from Open Data)
    public DbSet<PublicHoliday> PublicHolidays { get; set; } = null!;

    // EO-454: team-level holiday/school-holiday calendar slot configuration (labels, tones, sources)
    public DbSet<HolidayCalendarSlot> HolidayCalendarSlots { get; set; } = null!;

    // EO-421: tenant-wide display settings (single row)
    public DbSet<PlanningDisplaySettings> DisplaySettings { get; set; } = null!;

    // EO-425: mailbox sync configuration (single row)
    public DbSet<MailboxSyncConfig> MailboxSyncConfigs { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(RppDbContext).Assembly);

        // Global query filters
        modelBuilder.Entity<AbsenceDto>().HasQueryFilter(a => a.Status != "deleted");
        modelBuilder.Entity<VacationRequestDto>().HasQueryFilter(r => r.Status != "cancelled");

        // EO-458: one primary assignment per user — filter syntax differs by engine.
        ApplyPrimaryMemberUniqueFilter(modelBuilder);
    }

    private void ApplyPrimaryMemberUniqueFilter(ModelBuilder modelBuilder)
    {
        var index = modelBuilder.Entity<TeamAdminMemberAssignment>().Metadata
            .GetIndexes()
            .FirstOrDefault(candidate =>
                candidate.IsUnique
                && string.Equals(
                    candidate.GetDatabaseName(),
                    "IX_TeamAdminMemberAssignments_UserId_IsPrimary_Unique",
                    StringComparison.Ordinal));

        if (index is null)
        {
            return;
        }

        // Database.ProviderName is set once the context is configured with UseSqlServer / UseNpgsql.
        if (Database.IsNpgsql())
        {
            index.SetFilter("\"IsPrimary\" = TRUE");
        }
        else
        {
            // SQL Server (default relational path) — keep the historical filter text.
            index.SetFilter("IsPrimary = 1");
        }
    }
}