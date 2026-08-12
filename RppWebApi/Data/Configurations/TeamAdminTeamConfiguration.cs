using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class TeamAdminTeamConfiguration : IEntityTypeConfiguration<TeamAdminTeam>
{
    public void Configure(EntityTypeBuilder<TeamAdminTeam> builder)
    {
        builder.ToTable("TeamAdminTeams");

        builder.HasKey(t => t.TeamId);

        builder.Property(t => t.TeamId).HasMaxLength(50).IsRequired();
        builder.Property(t => t.TeamName).HasMaxLength(200).IsRequired();
        builder.Property(t => t.Organization).HasMaxLength(100).IsRequired();
        builder.Property(t => t.CanManage).IsRequired();

        builder.HasIndex(t => t.TeamName).IsUnique();
        builder.HasIndex(t => t.SortOrder);

        // One-to-one with Settings
        builder.HasOne(t => t.Settings)
               .WithOne(s => s.Team)
               .HasForeignKey<TeamAdminSettings>(s => s.TeamId)
               .OnDelete(DeleteBehavior.Cascade);

        // One-to-many with MemberAssignments
        builder.HasMany(t => t.MemberAssignments)
               .WithOne(ma => ma.Team)
               .HasForeignKey(ma => ma.TeamId)
               .OnDelete(DeleteBehavior.Cascade);
    }
}
