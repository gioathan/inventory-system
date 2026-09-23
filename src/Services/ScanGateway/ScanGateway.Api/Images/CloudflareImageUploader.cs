using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace InventorySystem.ScanGateway.Api.Images;

public class CloudflareImagesOptions
{
    public string AccountId { get; set; } = "";
    public string ApiToken { get; set; } = "";
}

// Real implementation, talking to Cloudflare's actual Images API — see
// https://developers.cloudflare.com/api/operations/cloudflare-images-upload-an-image-via-url
// (the "upload a single image" v1 endpoint). Not exercised by the automated test suite: there's
// no local/Dockerized stand-in for Cloudflare, so this is verified manually against a real
// account instead — see the interface's own doc comment and TECH_DEBT.md.
public class CloudflareImageUploader(HttpClient httpClient, IOptions<CloudflareImagesOptions> options) : ICloudflareImageUploader
{
    public async Task<string> UploadAsync(Stream content, string fileName, string contentType, CancellationToken cancellationToken)
    {
        var accountId = options.Value.AccountId;
        var apiToken = options.Value.ApiToken;

        // Fails only when actually called, not at startup — the rest of the system (and every
        // other way of setting Item.ImageUrl) works fine with Cloudflare Images unconfigured.
        if (string.IsNullOrWhiteSpace(accountId) || string.IsNullOrWhiteSpace(apiToken))
            throw new ImageUploadException("Cloudflare Images is not configured (missing account id or API token).");

        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"https://api.cloudflare.com/client/v4/accounts/{accountId}/images/v1");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiToken);

        using var form = new MultipartFormDataContent();
        using var fileContent = new StreamContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(fileContent, "file", fileName);
        request.Content = form;

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadFromJsonAsync<CloudflareUploadResponse>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || body is null || !body.Success)
        {
            var reason = body?.Errors is { Count: > 0 } errors
                ? string.Join("; ", errors.Select(e => e.Message))
                : $"HTTP {(int)response.StatusCode}";
            throw new ImageUploadException($"Cloudflare Images upload failed: {reason}");
        }

        // Cloudflare returns one delivery URL per configured "variant" (size/format preset);
        // this account has no custom variants configured, so the first (and only) one is the
        // default "public" delivery URL.
        return body.Result?.Variants?.FirstOrDefault()
            ?? throw new ImageUploadException("Cloudflare Images upload succeeded but returned no delivery URL.");
    }

    private record CloudflareUploadResponse(bool Success, CloudflareUploadResult? Result, List<CloudflareError>? Errors);
    private record CloudflareUploadResult(string Id, List<string>? Variants);
    private record CloudflareError(int Code, string Message);
}
