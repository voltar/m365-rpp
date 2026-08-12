using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class TeamAdminAbsenceTypeConfiguration : IEntityTypeConfiguration<TeamAdminAbsenceType>
{
    public void Configure(EntityTypeBuilder<TeamAdminAbsenceType> builder)
    {
        builder.ToTable("TeamAdminAbsenceTypes");

        builder.HasKey(t => t.Key);

        builder.Property(t => t.Key).HasMaxLength(100).IsRequired();
        builder.Property(t => t.Label).HasMaxLength(200);
        builder.Property(t => t.LabelKey).HasMaxLength(100);

        builder.HasIndex(t => t.SortOrder);
    }
}
