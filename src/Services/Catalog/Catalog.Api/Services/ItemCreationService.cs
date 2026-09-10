using System.Security.Cryptography;
using InventorySystem.Catalog.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace InventorySystem.Catalog.Api.Services;

public class ItemCreationService(CatalogDbContext db)
{
    // A collision on a randomly-generated 12-digit code is astronomically unlikely; this bound
    // only exists as a sane failure mode if something is deeply wrong (e.g. near-exhausted space).
    private const int MaxGenerationAttempts = 5;

    public async Task<Item> CreateItemAsync(
        string name,
        decimal price,
        string? barcode,
        string? sku,
        Guid? categoryId,
        string? imageUrl,
        CancellationToken cancellationToken)
    {
        var barcodeProvided = !string.IsNullOrWhiteSpace(barcode);
        var skuProvided = !string.IsNullOrWhiteSpace(sku);

        for (var attempt = 0; ; attempt++)
        {
            // Reusing one generated code for both Sku and Barcode when neither is supplied
            // matches how this system is actually used: the code IS the item's identifier.
            var candidateBarcode = barcodeProvided ? barcode! : GenerateCode();
            var candidateSku = skuProvided ? sku! : candidateBarcode;

            var item = new Item
            {
                Id = Guid.NewGuid(),
                Sku = candidateSku,
                Name = name,
                Price = price,
                Barcode = candidateBarcode,
                CategoryId = categoryId,
                ImageUrl = imageUrl
            };

            db.Items.Add(item);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return item;
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                db.Entry(item).State = EntityState.Detached;

                // A caller-supplied Sku/Barcode conflicting is a real conflict — surface it.
                // An auto-generated code colliding is just bad luck — try a new one.
                if (barcodeProvided || skuProvided || attempt >= MaxGenerationAttempts - 1)
                    throw new ItemAlreadyExistsException(candidateSku, candidateBarcode);
            }
        }
    }

    private static string GenerateCode()
    {
        Span<byte> bytes = stackalloc byte[8];
        RandomNumberGenerator.Fill(bytes);
        var value = BitConverter.ToUInt64(bytes) % 1_000_000_000_000UL;
        return value.ToString("D12");
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}

public class ItemAlreadyExistsException(string sku, string barcode)
    : Exception($"An item with SKU '{sku}' or barcode '{barcode}' already exists.");
