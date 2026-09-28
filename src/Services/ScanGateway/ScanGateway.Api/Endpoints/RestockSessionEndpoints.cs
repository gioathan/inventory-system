using global::Grpc.Core;
using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

// Restock sessions, exposed so the frontend can run them. Inventory owns the logic (one open at
// a time, starting one closes the previous, receives auto-tagged server-side); these routes just
// translate. Per-session numbers come from Dashboard's sessionReport GraphQL query, not here —
// that's where quantities get joined with Catalog prices for revenue.
public static class RestockSessionEndpoints
{
    public static void MapRestockSessionEndpoints(this WebApplication app)
    {
        // Sellers see which session their receives are being logged to, so this one read is
        // open to both roles. "No session open" is a normal state: 200 with a null session.
        app.MapGet("/restock-sessions/current", async (InventoryApiClient inventory, CancellationToken cancellationToken) =>
            Results.Ok(new CurrentRestockSessionResponse(await inventory.GetCurrentRestockSessionAsync(cancellationToken))))
            .RequireAuthorization(AuthPolicies.SellerOrAdmin);

        // Units sold/received per item in the open session — counts only, no revenue, so sellers
        // can see what's moving. Lines are empty (and session null) when no session is open.
        app.MapGet("/restock-sessions/current/sales", async (InventoryApiClient inventory, CancellationToken cancellationToken) =>
            Results.Ok(await inventory.GetCurrentSessionSalesAsync(cancellationToken)))
            .RequireAuthorization(AuthPolicies.SellerOrAdmin);

        var admin = app.MapGroup("/restock-sessions").RequireAuthorization(AuthPolicies.AdminOnly);

        admin.MapGet("", async (InventoryApiClient inventory, CancellationToken cancellationToken) =>
            Results.Ok(await inventory.ListRestockSessionsAsync(cancellationToken)));

        // Starting a session closes whichever one was open; the response says which, if any.
        admin.MapPost("", async (OpenRestockSessionBody? body, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            var note = body?.Note?.Trim();
            if (note is { Length: > 200 })
                return Results.BadRequest("Keep the note under 200 characters.");

            try
            {
                var (opened, closed) = await inventory.OpenRestockSessionAsync(note, cancellationToken);
                return Results.Created($"/restock-sessions/{opened.Id}", new OpenRestockSessionResponse(opened, closed));
            }
            catch (RestockSessionOperationException ex)
            {
                return Results.Conflict(ex.Message);
            }
        });

        admin.MapPost("/{id:guid}/close", async (Guid id, InventoryApiClient inventory, CancellationToken cancellationToken) =>
        {
            try
            {
                return Results.Ok(await inventory.CloseRestockSessionAsync(id, cancellationToken));
            }
            catch (RestockSessionOperationException ex)
            {
                return ex.StatusCode == StatusCode.NotFound ? Results.NotFound(ex.Message) : Results.Conflict(ex.Message);
            }
        });
    }
}

public record OpenRestockSessionBody(string? Note);
public record CurrentRestockSessionResponse(RestockSession? Session);
public record OpenRestockSessionResponse(RestockSession Opened, RestockSession? Closed);
