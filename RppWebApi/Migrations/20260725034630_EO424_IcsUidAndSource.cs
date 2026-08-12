using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO424_IcsUidAndSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IcsUid",
                table: "Absences",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "Absences",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "manual");

            migrationBuilder.CreateIndex(
                name: "IX_Absences_IcsUid",
                table: "Absences",
                column: "IcsUid");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Absences_IcsUid",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "IcsUid",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "Absences");
        }
    }
}
