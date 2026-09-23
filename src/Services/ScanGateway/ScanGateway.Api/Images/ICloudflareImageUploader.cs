namespace InventorySystem.ScanGateway.Api.Images;

// Deliberately abstracted behind an interface: Cloudflare Images is the first dependency in
// this whole system that can't be run locally in Docker like everything else (Postgres,
// RabbitMQ, Redis, Mongo all can). Endpoint logic (validation, status codes, error shape) is
// unit-tested against a fake implementation of this; the real one is exercised manually against
// a live Cloudflare account, not by the automated test suite. See TECH_DEBT.md.
public interface ICloudflareImageUploader
{
    // Returns the public delivery URL for the uploaded image — the same kind of plain string
    // Item.ImageUrl already stores regardless of where it came from.
    Task<string> UploadAsync(Stream content, string fileName, string contentType, CancellationToken cancellationToken);
}

public class ImageUploadException(string message) : Exception(message);
