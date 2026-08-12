using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO408_TeamAdminNormalizedTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TeamAdminTeams",
                columns: table => new
                {
                    TeamId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    TeamName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Organization = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CanManage = table.Column<bool>(type: "bit", nullable: false),
                    LastModified = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamAdminTeams", x => x.TeamId);
                });

            migrationBuilder.CreateTable(
                name: "TeamAdminMemberAssignments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    TeamId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    IsPrimary = table.Column<bool>(type: "bit", nullable: false),
                    AdditionalPosition = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    EmploymentPercentage = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    VacationBalance = table.Column<int>(type: "int", nullable: false),
                    ApprovalExempt = table.Column<bool>(type: "bit", nullable: false),
                    EffectiveApproverUserId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    LastModified = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamAdminMemberAssignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TeamAdminMemberAssignments_TeamAdminTeams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "TeamAdminTeams",
                        principalColumn: "TeamId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TeamAdminSettings",
                columns: table => new
                {
                    TeamId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    TeamLeadUserId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    DefaultApproverUserId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    BackupApproverUserId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    ApprovalPolicy = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    AllowUserOverride = table.Column<bool>(type: "bit", nullable: false),
                    OutlookSyncEnabled = table.Column<bool>(type: "bit", nullable: false),
                    LastModified = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamAdminSettings", x => x.TeamId);
                    table.ForeignKey(
                        name: "FK_TeamAdminSettings_TeamAdminTeams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "TeamAdminTeams",
                        principalColumn: "TeamId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TeamAdminMemberAssignments_TeamId_UserId_IsPrimary",
                table: "TeamAdminMemberAssignments",
                columns: new[] { "TeamId", "UserId", "IsPrimary" });

            migrationBuilder.CreateIndex(
                name: "IX_TeamAdminMemberAssignments_UserId_IsPrimary",
                table: "TeamAdminMemberAssignments",
                columns: new[] { "UserId", "IsPrimary" },
                unique: true,
                filter: "IsPrimary = 1");

            migrationBuilder.CreateIndex(
                name: "IX_TeamAdminTeams_SortOrder",
                table: "TeamAdminTeams",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_TeamAdminTeams_TeamName",
                table: "TeamAdminTeams",
                column: "TeamName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TeamAdminMemberAssignments");

            migrationBuilder.DropTable(
                name: "TeamAdminSettings");

            migrationBuilder.DropTable(
                name: "TeamAdminTeams");
        }
    }
}
