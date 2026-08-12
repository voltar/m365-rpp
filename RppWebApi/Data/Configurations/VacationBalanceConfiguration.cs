using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class VacationBalanceConfiguration : IEntityTypeConfiguration<VacationBalanceDto>
{
    public void Configure(EntityTypeBuilder<VacationBalanceDto> builder)
    {
        builder.ToTable("VacationBalances");

        builder.HasKey(b => new { b.EmployeeId, b.Year });

        builder.Property(b => b.EmployeeId).HasMaxLength(100).IsRequired();
        builder.Property(b => b.Comment).HasMaxLength(500);

        builder.Property(b => b.Entitlement).HasPrecision(10, 2);
        builder.Property(b => b.CarryForward).HasPrecision(10, 2);
        builder.Property(b => b.ManualAdjustment).HasPrecision(10, 2);
        builder.Property(b => b.ApprovedVacation).HasPrecision(10, 2);
        builder.Property(b => b.PendingVacation).HasPrecision(10, 2);
        builder.Property(b => b.Remaining).HasPrecision(10, 2);

        // Unique constraint per employee + year (EO-101-A)
        builder.HasIndex(b => new { b.EmployeeId, b.Year }).IsUnique();
    }
}