using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RppWebApi.Migrations
{
    /// <inheritdoc />
    public partial class EO410_VacationRequestApprovalFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovalProvider",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CommentToApprover",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DecisionBy",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DecisionComment",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DecisionDate",
                table: "VacationRequests",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FlowRunId",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TeamId",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "UserDisplayName",
                table: "VacationRequests",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApprovalProvider",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "CommentToApprover",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "DecisionBy",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "DecisionComment",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "DecisionDate",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "FlowRunId",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "TeamId",
                table: "VacationRequests");

            migrationBuilder.DropColumn(
                name: "UserDisplayName",
                table: "VacationRequests");
        }
    }
}
