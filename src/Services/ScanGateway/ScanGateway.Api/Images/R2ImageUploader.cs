using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace InventorySystem.ScanGateway.Api.Images;

public class R2ImageOptions
{
    public string AccountId { get; set; } = "";
    public string AccessKeyId { get; set; } = "";
    public string SecretAccessKey { get; set; } = "";
    public string BucketName { get; set; } = "";

    // R2 has no built-in CDN delivery the way Cloudflare Images did — the bucket needs its
    // "Public access" (r2.dev subdomain, or a connected custom domain) turned on in the
    // dashboard first, and this is that base URL. An uploaded object is unreachable without it,
    // so a blank value here is treated the same as a blank access key: not configured.
    public string PublicBaseUrl { get; set; } = "";
}

// Real implementation, talking to R2's actual (S3-compatible) API via the AWS SDK pointed at
// R2's endpoint — see https://developers.cloudflare.com/r2/api/s3/api/. Not exercised by the
// automated test suite: there's no local/Dockerized stand-in for R2, so this is verified
// manually against a real bucket instead — see the interface's own doc comment and TECH_DEBT.md.
public class R2ImageUploader(IOptions<R2ImageOptions> options) : IImageUploader
{
    private AmazonS3Client? client;

    public async Task<string> UploadAsync(Stream content, string fileName, string contentType, CancellationToken cancellationToken)
    {
        var o = options.Value;

        // Fails only when actually called, not at startup — the rest of the system (and every
        // other way of setting Item.ImageUrl) works fine with R2 unconfigured.
        if (string.IsNullOrWhiteSpace(o.AccountId) || string.IsNullOrWhiteSpace(o.AccessKeyId) ||
            string.IsNullOrWhiteSpace(o.SecretAccessKey) || string.IsNullOrWhiteSpace(o.BucketName) ||
            string.IsNullOrWhiteSpace(o.PublicBaseUrl))
        {
            throw new ImageUploadException("R2 image storage is not configured (account id, access key, secret key, bucket name, or public URL is missing).");
        }

        var key = BuildObjectKey(fileName);

        try
        {
            await GetClient(o).PutObjectAsync(new PutObjectRequest
            {
                BucketName = o.BucketName,
                Key = key,
                InputStream = content,
                ContentType = contentType,
                AutoCloseStream = false,
                // R2 also doesn't implement the SDK's chunked/streaming SigV4 payload signing
                // (STREAMING-AWS4-HMAC-SHA256-PAYLOAD) that RequestChecksumCalculation alone
                // doesn't turn off — this signs the whole payload up front in the Authorization
                // header instead, over HTTPS (required for this to be safe, and R2's endpoint
                // always is). Confirmed against a live bucket, not just from docs.
                DisablePayloadSigning = true,
            }, cancellationToken);
        }
        catch (AmazonS3Exception ex)
        {
            throw new ImageUploadException($"R2 upload failed: {ex.Message}");
        }

        return BuildPublicUrl(o.PublicBaseUrl, key);
    }

    // Cached across calls: an AmazonS3Client owns its own HttpClient, and the options here don't
    // change without a restart, so building one per request would be pure waste.
    private AmazonS3Client GetClient(R2ImageOptions o) =>
        client ??= new AmazonS3Client(o.AccessKeyId, o.SecretAccessKey, new AmazonS3Config
        {
            ServiceURL = $"https://{o.AccountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true, // R2 doesn't support S3's virtual-hosted-style bucket URLs
            // The SDK's default (WHEN_SUPPORTED) streams a trailing checksum after the payload
            // (STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER) — R2 doesn't implement that mode and
            // rejects the upload outright. WHEN_REQUIRED only adds a checksum when the operation
            // actually demands one, which PutObject doesn't, avoiding the trailer entirely.
            // Confirmed against a live bucket, not just from docs — see TECH_DEBT.md.
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
        });

    // A random, unguessable key rather than the original filename — two sellers uploading
    // "photo.jpg" the same day must never collide or overwrite each other. The extension is kept
    // only so a stored object still looks like what it is if you ever browse the bucket by hand.
    public static string BuildObjectKey(string fileName)
    {
        var extension = Path.GetExtension(fileName);
        var safeExtension = extension.Length is > 0 and <= 10 && extension.All(c => char.IsLetterOrDigit(c) || c == '.') ? extension : "";
        return $"{Guid.NewGuid():N}{safeExtension}";
    }

    public static string BuildPublicUrl(string publicBaseUrl, string key) => $"{publicBaseUrl.TrimEnd('/')}/{key}";
}
