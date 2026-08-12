using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO425_MailboxSyncAddress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MailboxSyncConfigs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    MailboxAddress = table.Column<string>(type: "nvarchar(320)", maxLength: 320, nullable: false),
                    LastModified = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MailboxSyncConfigs", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MailboxSyncConfigs");
        }
    }
}
