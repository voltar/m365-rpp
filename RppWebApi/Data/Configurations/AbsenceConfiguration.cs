using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RppWebApi.Models;

namespace RppWebApi.Data.Configurations;

public class AbsenceConfiguration : IEntityTypeConfiguration<AbsenceDto>
{
    public void Configure(EntityTypeBuilder<AbsenceDto> builder)
    {
        builder.ToTable("Absences");

        builder.HasKey(a => a.Id);

        builder.Property(a => a.Id).HasMaxLength(50);
        builder.Property(a => a.EmployeeId).HasMaxLength(100).IsRequired();
        builder.Property(a => a.Type).HasMaxLength(50).IsRequired();
        builder.Property(a => a.StartHalf).HasMaxLength(20);
        builder.Property(a => a.EndHalf).HasMaxLength(20);
        builder.Property(a => a.Status).HasMaxLength(30).IsRequired();
        builder.Property(a => a.Comment).HasMaxLength(500);
        builder.Property(a => a.Substitute).HasMaxLength(100);

        builder.Property(a => a.Duration).HasPrecision(10, 2);

        // EO-424: inbound Outlook mailbox sync
        builder.Property(a => a.IcsUid).HasMaxLength(255);
        builder.Property(a => a.Source).HasMaxLength(50).IsRequired().HasDefaultValue("manual");

        // Indexes for performance (matching EO-101-A recommendations)
        builder.HasIndex(a => new { a.EmployeeId, a.StartDate });
        builder.HasIndex(a => a.Status);
        builder.HasIndex(a => a.Type);
        builder.HasIndex(a => a.IcsUid);
    }
}