using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO454_HolidayCalendarSlotConfiguration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HolidayCalendarSlots",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    TeamId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    DisplayLabel = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Tone = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    SourceType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    SourceUrl = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    MicrosoftPreset = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    LastModified = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HolidayCalendarSlots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HolidayCalendarSlots_TeamAdminTeams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "TeamAdminTeams",
                        principalColumn: "TeamId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarSlots_TeamId",
                table: "HolidayCalendarSlots",
                column: "TeamId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HolidayCalendarSlots");
        }
    }
}
