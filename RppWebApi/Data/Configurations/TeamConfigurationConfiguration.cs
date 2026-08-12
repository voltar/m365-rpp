using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class TeamConfigurationConfiguration : IEntityTypeConfiguration<TeamConfiguration>
{
    public void Configure(EntityTypeBuilder<TeamConfiguration> builder)
    {
        builder.ToTable("TeamPlanningConfiguration");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Id).HasMaxLength(50);
        builder.Property(t => t.TeamId).HasMaxLength(100).IsRequired();
        builder.Property(t => t.TeamName).HasMaxLength(200).IsRequired();
        builder.Property(t => t.DefaultApproverId).HasMaxLength(100).IsRequired();
        builder.Property(t => t.BackupApproverId).HasMaxLength(100);
        builder.Property(t => t.Comment).HasMaxLength(500);

        builder.HasIndex(t => t.TeamId).IsUnique();
    }
}