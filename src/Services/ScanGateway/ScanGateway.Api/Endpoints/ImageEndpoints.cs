using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Images;
using Microsoft.Extensions.Options;

namespace InventorySystem.ScanGateway.Api.Endpoints;

public static class ImageEndpoints
{
    public static void MapImageEndpoints(this WebApplication app)
    {
        // Deliberately separate from /items/intake, not a combined "create item with an
        // optional file" endpoint — uploading an image and creating an item are independent
        // concerns. An admin who already has a URL from anywhere skips this entirely and just
        // passes it straight into intake's existing imageUrl field; this only exists for the
        // "I have a raw file, not a link yet" case. Admin-only, same as categories/discounts —
        // admin-managed setup, not a day-to-day seller action.
        app.MapPost("/images", async (HttpRequest request, IImageUploader uploader, IOptions<R2ImageOptions> options, CancellationToken cancellationToken) =>
        {
            // Binding straight from HttpRequest instead of an IFormFile parameter is
            // deliberate: minimal APIs bind IFormFile by reading the form during argument
            // binding, before the handler body runs, so a request with no multipart body at
            // all throws its own BadHttpRequestException instead of hitting our validation
            // below — confirmed by hitting POST /images with no body and getting a raw
            // exception page instead of "An image file is required." Checking
            // HasFormContentType ourselves first avoids that entirely.
            if (!request.HasFormContentType)
                return Results.BadRequest("An image file is required.");

            var form = await request.ReadFormAsync(cancellationToken);
            var file = form.Files.GetFile("file");

            if (file is null || file.Length == 0)
                return Results.BadRequest("An image file is required.");

            // The browser shrinks pictures before sending them; this is the cap for anything that
            // didn't (see R2ImageOptions.MaxBytes), checked before a byte reaches the bucket.
            var maxBytes = options.Value.MaxBytes;
            if (file.Length > maxBytes)
                return Results.BadRequest($"That picture is {file.Length / 1024} KB; the limit is {maxBytes / 1024} KB. Upload it from the app, which shrinks it first.");

            if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest($"'{file.ContentType}' is not an image content type.");

            try
            {
                await using var stream = file.OpenReadStream();
                var imageUrl = await uploader.UploadAsync(stream, file.FileName, file.ContentType, cancellationToken);
                return Results.Ok(new ImageUploadResponse(imageUrl));
            }
            catch (ImageUploadException ex)
            {
                // 502: this service is a proxy to R2 here, and the failure is on R2's side (or
                // in how this service is configured to reach it) — not a problem with the
                // caller's request, once it's passed the checks above.
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        }).RequireAuthorization(AuthPolicies.AdminOnly).DisableAntiforgery();
    }
}

public record ImageUploadResponse(string ImageUrl);
