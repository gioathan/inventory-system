using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InventorySystem.Catalog.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddItemLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Location",
                table: "Items",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Location",
                table: "Items");
        }
    }
}
