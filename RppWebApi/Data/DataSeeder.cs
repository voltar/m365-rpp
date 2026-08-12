using Microsoft.EntityFrameworkCore;
using RppWebApi.Models;
using RppWebApi.Services;

namespace RppWebApi.Data;

/// <summary>
/// Seeds realistic demo data on startup (development only).
/// Employee ids come from the real Microsoft Graph team members, so the seeded
/// absences and balances are visible on the Timeline and in Team Capacity.
/// Legacy rows with mock "resource-*" ids are removed.
/// </summary>
public static class DataSeeder
{
    public static async Task SeedAsync(RppDbContext context, GraphTeamMembershipService graphService)
    {
        await RemoveLegacyMockRowsAsync(context);

        if (await context.Absences.AnyAsync() || await context.VacationBalances.AnyAsync())
        {
            return; // already seeded with real data
        }

        var members = await graphService.GetRealTeamMembersAsync();
        var employeeIds = members
            .Select(member => member.Member?.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Cast<string>()
            .Distinct()
            .Take(3)
            .ToList();

        if (employeeIds.Count == 0)
        {
            Console.WriteLine("Seeding skipped: no Graph team members available.");
            return;
        }

        var year = DateTime.UtcNow.Year;
        var seedTemplates = new[]
        {
            new { Type = "vacation", StartDay = new DateTime(year, 7, 6), Days = 26, Duration = 20m, Comment = "Sommerferien", CarryForward = 5m, Approved = 12m, Pending = 3m },
            new { Type = "vacation", StartDay = new DateTime(year, 7, 13), Days = 12, Duration = 10m, Comment = "Sommerferien", CarryForward = 2m, Approved = 8m, Pending = 5m },
            new { Type = "training", StartDay = new DateTime(year, 7, 8), Days = 5, Duration = 5m, Comment = "Azure Training", CarryForward = 0m, Approved = 6m, Pending = 2m }
        };

        for (var index = 0; index < employeeIds.Count; index += 1)
        {
            var employeeId = employeeIds[index];
            var template = seedTemplates[index % seedTemplates.Length];

            context.Absences.Add(new AbsenceDto
            {
                Id = $"abs-seed-{index + 1:000}",
                EmployeeId = employeeId,
                Type = template.Type,
                StartDate = template.StartDay,
                EndDate = template.StartDay.AddDays(template.Days - 1),
                Duration = template.Duration,
                Status = "approved",
                Comment = template.Comment,
                Created = DateTime.UtcNow.AddDays(-30),
                Modified = DateTime.UtcNow
            });

            context.VacationBalances.Add(new VacationBalanceDto
            {
                EmployeeId = employeeId,
                Year = year,
                Entitlement = 25,
                CarryForward = template.CarryForward,
                ManualAdjustment = 0,
                ApprovedVacation = template.Approved,
                PendingVacation = template.Pending,
                Remaining = 25 + template.CarryForward - template.Approved - template.Pending
            });
        }

        await context.SaveChangesAsync();
        Console.WriteLine($"Database seeded with demo data for {employeeIds.Count} real Graph members.");
    }

    private static async Task RemoveLegacyMockRowsAsync(RppDbContext context)
    {
        var legacyAbsences = await context.Absences
            .IgnoreQueryFilters()
            .Where(absence => absence.EmployeeId.StartsWith("resource-"))
            .ToListAsync();
        var legacyBalances = await context.VacationBalances
            .Where(balance => balance.EmployeeId.StartsWith("resource-"))
            .ToListAsync();

        if (legacyAbsences.Count == 0 && legacyBalances.Count == 0)
        {
            return;
        }

        context.Absences.RemoveRange(legacyAbsences);
        context.VacationBalances.RemoveRange(legacyBalances);
        await context.SaveChangesAsync();
        Console.WriteLine($"Removed {legacyAbsences.Count} legacy absences and {legacyBalances.Count} legacy balances with mock resource ids.");
    }
}
