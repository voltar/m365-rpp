using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class TeamAdminMemberAssignmentConfiguration : IEntityTypeConfiguration<TeamAdminMemberAssignment>
{
    public void Configure(EntityTypeBuilder<TeamAdminMemberAssignment> builder)
    {
        builder.ToTable("TeamAdminMemberAssignments");

        builder.HasKey(ma => ma.Id);

        builder.Property(ma => ma.UserId).HasMaxLength(100).IsRequired();
        builder.Property(ma => ma.TeamId).HasMaxLength(50).IsRequired();
        builder.Property(ma => ma.AdditionalPosition).HasMaxLength(200);
        builder.Property(ma => ma.EffectiveApproverUserId).HasMaxLength(100);
        builder.Property(ma => ma.EmploymentPercentage).HasPrecision(5, 2);
        builder.Property(ma => ma.VacationBalance).HasPrecision(6, 2);

        // Composite index for fast lookup of members per team + primary flag
        builder.HasIndex(ma => new { ma.TeamId, ma.UserId, ma.IsPrimary });

        // Ensure a user can only have one primary team. The filtered unique index DDL is
        // provider-specific (SQL Server vs PostgreSQL); RppDbContext.OnModelCreating sets the
        // filter for the active engine (EO-458 / ADR-007).
        builder.HasIndex(ma => new { ma.UserId, ma.IsPrimary })
               .IsUnique()
               .HasDatabaseName("IX_TeamAdminMemberAssignments_UserId_IsPrimary_Unique");
    }
}
