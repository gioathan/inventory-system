using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InventorySystem.Catalog.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPriceAndImageToItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "Items",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Price",
                table: "Items",
                type: "numeric(18,2)",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "Price",
                table: "Items");
        }
    }
}
