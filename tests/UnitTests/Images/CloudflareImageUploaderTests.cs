using System.Net;
using System.Text;
using InventorySystem.ScanGateway.Api.Images;
using Microsoft.Extensions.Options;

namespace InventorySystem.UnitTests.Images;

// CloudflareImageUploader is the one piece of this whole system that can't be verified against
// a real, local instance of its dependency the way everything else in this project is (there's
// no Dockerized Cloudflare). These tests instead pin down its contract against Cloudflare's
// documented response shape — real behavior against a live account still needs a manual check
// once real credentials exist; see TECH_DEBT.md.
public class CloudflareImageUploaderTests
{
    private static CloudflareImageUploader CreateUploader(
        FakeHttpMessageHandler handler, string accountId = "test-account", string apiToken = "test-token")
    {
        var httpClient = new HttpClient(handler);
        var options = Options.Create(new CloudflareImagesOptions { AccountId = accountId, ApiToken = apiToken });
        return new CloudflareImageUploader(httpClient, options);
    }

    private static Stream ImageBytes() => new MemoryStream(Encoding.UTF8.GetBytes("not-a-real-image-just-test-bytes"));

    [Fact]
    public async Task UploadAsync_OnSuccess_ReturnsTheDeliveryUrlAndPostsToTheDocumentedEndpoint()
    {
        var responseJson = """
            {
              "result": {
                "id": "2cdc28f0-017a-49c4-9ed7-87056c83901",
                "filename": "widget.png",
                "variants": ["https://imagedelivery.net/abc123/2cdc28f0-017a-49c4-9ed7-87056c83901/public"]
              },
              "success": true,
              "errors": [],
              "messages": []
            }
            """;
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, responseJson);
        var uploader = CreateUploader(handler, accountId: "acct-123", apiToken: "secret-token");

        var url = await uploader.UploadAsync(ImageBytes(), "widget.png", "image/png", CancellationToken.None);

        Assert.Equal("https://imagedelivery.net/abc123/2cdc28f0-017a-49c4-9ed7-87056c83901/public", url);
        Assert.NotNull(handler.LastRequest);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://api.cloudflare.com/client/v4/accounts/acct-123/images/v1", handler.LastRequest.RequestUri!.ToString());
        Assert.Equal("Bearer", handler.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("secret-token", handler.LastRequest.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task UploadAsync_WhenCloudflareReportsFailure_ThrowsWithTheirErrorMessage()
    {
        var responseJson = """
            {
              "result": null,
              "success": false,
              "errors": [{ "code": 5455, "message": "Unsupported image format" }],
              "messages": []
            }
            """;
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, responseJson);
        var uploader = CreateUploader(handler);

        var ex = await Assert.ThrowsAsync<ImageUploadException>(() =>
            uploader.UploadAsync(ImageBytes(), "widget.bmp", "image/bmp", CancellationToken.None));

        Assert.Contains("Unsupported image format", ex.Message);
    }

    [Fact]
    public async Task UploadAsync_OnNon2xxHttpStatus_ThrowsImageUploadException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Unauthorized, """{"success":false,"errors":[]}""");
        var uploader = CreateUploader(handler, apiToken: "wrong-token");

        await Assert.ThrowsAsync<ImageUploadException>(() =>
            uploader.UploadAsync(ImageBytes(), "widget.png", "image/png", CancellationToken.None));
    }

    [Fact]
    public async Task UploadAsync_WhenSuccessfulButNoVariantsReturned_ThrowsRatherThanReturningNull()
    {
        var responseJson = """{"result":{"id":"abc","variants":[]},"success":true,"errors":[]}""";
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, responseJson);
        var uploader = CreateUploader(handler);

        await Assert.ThrowsAsync<ImageUploadException>(() =>
            uploader.UploadAsync(ImageBytes(), "widget.png", "image/png", CancellationToken.None));
    }

    [Theory]
    [InlineData("", "token")]
    [InlineData("account", "")]
    [InlineData("", "")]
    public async Task UploadAsync_WhenNotConfigured_ThrowsWithoutMakingAnyHttpCall(string accountId, string apiToken)
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, "{}");
        var uploader = CreateUploader(handler, accountId, apiToken);

        await Assert.ThrowsAsync<ImageUploadException>(() =>
            uploader.UploadAsync(ImageBytes(), "widget.png", "image/png", CancellationToken.None));

        Assert.Null(handler.LastRequest); // never even tried to reach Cloudflare
    }
}
