using System.Net;

namespace InventorySystem.UnitTests.Images;

// Captures the last request it received and returns whatever response the test configured —
// enough to both verify CloudflareImageUploader builds the right request and to simulate every
// shape Cloudflare's real API can return, without any actual network call.
public class FakeHttpMessageHandler(HttpStatusCode statusCode, string responseJson) : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest { get; private set; }
    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        LastRequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

        return new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(responseJson, System.Text.Encoding.UTF8, "application/json")
        };
    }
}
