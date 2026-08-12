using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO419_TeamAdminOwningTeamId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OwningTeamId",
                table: "TeamAdminTeams",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            // EO-419 backfill: existing internal teams belong to the RPP dev host team
            // (Graph:TeamGroupId of the demo tenant at migration time).
            migrationBuilder.Sql(
                "UPDATE TeamAdminTeams SET OwningTeamId = '2867c63c-2bfa-421d-ae1a-bcca12e1ce70' WHERE OwningTeamId = ''");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OwningTeamId",
                table: "TeamAdminTeams");
        }
    }
}
