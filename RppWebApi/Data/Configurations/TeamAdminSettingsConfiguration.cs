using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class TeamAdminSettingsConfiguration : IEntityTypeConfiguration<TeamAdminSettings>
{
    public void Configure(EntityTypeBuilder<TeamAdminSettings> builder)
    {
        builder.ToTable("TeamAdminSettings");

        builder.HasKey(s => s.TeamId);

        builder.Property(s => s.TeamId).HasMaxLength(50).IsRequired();
        builder.Property(s => s.TeamLeadUserId).HasMaxLength(100).IsRequired();
        builder.Property(s => s.DefaultApproverUserId).HasMaxLength(100).IsRequired();
        builder.Property(s => s.BackupApproverUserId).HasMaxLength(100);
        builder.Property(s => s.ApprovalPolicy).HasMaxLength(20).IsRequired();

        builder.Property(s => s.AllowUserOverride).IsRequired();
        builder.Property(s => s.OutlookSyncEnabled).IsRequired();
    }
}
