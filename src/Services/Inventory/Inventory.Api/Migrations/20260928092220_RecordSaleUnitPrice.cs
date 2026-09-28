using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InventorySystem.Inventory.Api.Migrations
{
    /// <inheritdoc />
    public partial class RecordSaleUnitPrice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "UnitPrice",
                table: "StockMovements",
                type: "numeric(18,4)",
                precision: 18,
                scale: 4,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UnitPrice",
                table: "StockMovements");
        }
    }
}
