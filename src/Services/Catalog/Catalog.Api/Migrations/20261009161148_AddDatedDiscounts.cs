using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InventorySystem.Catalog.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDatedDiscounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DatedDiscounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Percentage = table.Column<double>(type: "double precision", nullable: false),
                    SkippedYear = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DatedDiscounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DatedDiscountItem",
                columns: table => new
                {
                    DatedDiscountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sku = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DatedDiscountItem", x => new { x.DatedDiscountId, x.Sku });
                    table.ForeignKey(
                        name: "FK_DatedDiscountItem_DatedDiscounts_DatedDiscountId",
                        column: x => x.DatedDiscountId,
                        principalTable: "DatedDiscounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DatedDiscountPeriod",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DatedDiscountId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DatedDiscountPeriod", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DatedDiscountPeriod_DatedDiscounts_DatedDiscountId",
                        column: x => x.DatedDiscountId,
                        principalTable: "DatedDiscounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DatedDiscountPeriod_DatedDiscountId",
                table: "DatedDiscountPeriod",
                column: "DatedDiscountId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DatedDiscountItem");

            migrationBuilder.DropTable(
                name: "DatedDiscountPeriod");

            migrationBuilder.DropTable(
                name: "DatedDiscounts");
        }
    }
}
