using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InventorySystem.Catalog.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDiscountPercentageToItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "DiscountPercentage",
                table: "Items",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DiscountPercentage",
                table: "Items");
        }
    }
}
