using InventorySystem.ScanGateway.Api.Images;
using Microsoft.Extensions.Options;

namespace InventorySystem.UnitTests.Images;

// R2ImageUploader is the one piece of this whole system that can't be verified against a real,
// local instance of its dependency the way everything else in this project is (there's no
// Dockerized R2). Unlike the Cloudflare Images version this replaced, the actual upload call goes
// through the AWS SDK's own AmazonS3Client rather than a plain HttpClient this project injects —
// there's no seam left to fake the wire call through, so these tests cover what's actually ours:
// the not-configured guard (never even constructs a client) and the pure key/URL-building logic.
// The PutObjectAsync call itself is verified manually against a real bucket; see TECH_DEBT.md.
public class R2ImageUploaderTests
{
    private static Stream ImageBytes() => new MemoryStream("not-a-real-image-just-test-bytes"u8.ToArray());

    [Theory]
    [InlineData("", "key", "secret", "bucket", "https://pub.r2.dev")]
    [InlineData("acct", "", "secret", "bucket", "https://pub.r2.dev")]
    [InlineData("acct", "key", "", "bucket", "https://pub.r2.dev")]
    [InlineData("acct", "key", "secret", "", "https://pub.r2.dev")]
    [InlineData("acct", "key", "secret", "bucket", "")]
    public async Task UploadAsync_WhenAnyRequiredSettingIsMissing_ThrowsWithoutTouchingR2(
        string accountId, string accessKeyId, string secretAccessKey, string bucketName, string publicBaseUrl)
    {
        var options = Options.Create(new R2ImageOptions
        {
            AccountId = accountId,
            AccessKeyId = accessKeyId,
            SecretAccessKey = secretAccessKey,
            BucketName = bucketName,
            PublicBaseUrl = publicBaseUrl,
        });
        var uploader = new R2ImageUploader(options);

        var ex = await Assert.ThrowsAsync<ImageUploadException>(() =>
            uploader.UploadAsync(ImageBytes(), "widget.png", "image/png", CancellationToken.None));

        Assert.Contains("not configured", ex.Message);
    }

    [Theory]
    [InlineData("widget.png", ".png")]
    [InlineData("widget.jpeg", ".jpeg")]
    [InlineData("no-extension", "")]
    [InlineData("../../etc/passwd", "")] // a hostile filename must never survive into the stored key
    [InlineData("weird.tar.gz", ".gz")] // only the final extension is kept, same as Path.GetExtension elsewhere
    public void BuildObjectKey_KeepsAShortAlphanumericExtensionAndDropsAnythingElse(string fileName, string expectedExtension)
    {
        var key = R2ImageUploader.BuildObjectKey(fileName);

        Assert.EndsWith(expectedExtension, key);
        Assert.DoesNotContain('/', key);
        Assert.DoesNotContain('.', key[..32]); // the random part itself never contains a dot
    }

    [Fact]
    public void BuildObjectKey_IsUnique_AcrossCalls()
    {
        var a = R2ImageUploader.BuildObjectKey("widget.png");
        var b = R2ImageUploader.BuildObjectKey("widget.png");

        Assert.NotEqual(a, b);
    }

    [Theory]
    [InlineData("https://pub-abc.r2.dev", "abc123.png", "https://pub-abc.r2.dev/abc123.png")]
    [InlineData("https://pub-abc.r2.dev/", "abc123.png", "https://pub-abc.r2.dev/abc123.png")] // a trailing slash on the base doesn't double up
    public void BuildPublicUrl_JoinsTheBaseAndKeyWithExactlyOneSlash(string publicBaseUrl, string key, string expected)
    {
        Assert.Equal(expected, R2ImageUploader.BuildPublicUrl(publicBaseUrl, key));
    }
}
