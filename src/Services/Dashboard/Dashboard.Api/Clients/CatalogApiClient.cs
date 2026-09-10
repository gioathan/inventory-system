using System.Globalization;
using InventorySystem.Grpc.Contracts.Catalog;

namespace InventorySystem.Dashboard.Api.Clients;

public class CatalogApiClient(CatalogGrpcService.CatalogGrpcServiceClient grpcClient)
{
    public async Task<List<CatalogItem>> GetAllItemsAsync(CancellationToken cancellationToken)
    {
        var reply = await grpcClient.ListItemsAsync(new ListItemsRequest(), cancellationToken: cancellationToken);

        return reply.Items
            .Select(i => new CatalogItem(
                i.Sku,
                i.Name,
                i.Barcode,
                decimal.Parse(i.Price, CultureInfo.InvariantCulture),
                i.HasImageUrl ? i.ImageUrl : null,
                i.HasCategoryId ? Guid.Parse(i.CategoryId) : null))
            .ToList();
    }
}

public record CatalogItem(string Sku, string Name, string Barcode, decimal Price, string? ImageUrl, Guid? CategoryId);
