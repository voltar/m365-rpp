using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO410_AbsenceApprovalLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovalStatus",
                table: "Absences",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "VacationRequestId",
                table: "Absences",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApprovalStatus",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "VacationRequestId",
                table: "Absences");
        }
    }
}
