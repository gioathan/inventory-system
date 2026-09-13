using InventorySystem.Inventory.Api.Data;
using InventorySystem.Inventory.Api.Services;

namespace InventorySystem.Inventory.Api.Endpoints;

public static class RestockSessionEndpoints
{
    public static void MapRestockSessionEndpoints(this WebApplication app)
    {
        app.MapPost("/restock-sessions", async (OpenSessionRequest request, RestockSessionService sessions, CancellationToken cancellationToken) =>
        {
            try
            {
                var session = await sessions.OpenAsync(request.Note, cancellationToken);
                return Results.Created($"/restock-sessions/{session.Id}", ToResponse(session));
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(ex.Message);
            }
        });

        app.MapPost("/restock-sessions/{id:guid}/close", async (Guid id, RestockSessionService sessions, CancellationToken cancellationToken) =>
        {
            try
            {
                var session = await sessions.CloseAsync(id, cancellationToken);
                return session is null ? Results.NotFound() : Results.Ok(ToResponse(session));
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(ex.Message);
            }
        });

        app.MapGet("/restock-sessions", async (RestockSessionService sessions, CancellationToken cancellationToken) =>
            Results.Ok((await sessions.ListAsync(cancellationToken)).Select(ToResponse)));

        app.MapGet("/restock-sessions/current", async (RestockSessionService sessions, CancellationToken cancellationToken) =>
        {
            var session = await sessions.GetCurrentAsync(cancellationToken);
            return session is null ? Results.NotFound() : Results.Ok(ToResponse(session));
        });

        // Per-Sku restocked/sold/net summary is gRPC-only (GetSessionSummary) — Dashboard's
        // sessionReport is its only caller, so there's no REST twin to keep.

        // Raw ledger query — filter by any combination of Sku/session/date range.
        app.MapGet("/movements", async (string? sku, Guid? sessionId, DateTimeOffset? from, DateTimeOffset? to, RestockSessionService sessions, CancellationToken cancellationToken) =>
            Results.Ok((await sessions.GetMovementsAsync(sku, sessionId, from, to, cancellationToken)).Select(ToResponse)));
    }

    private static RestockSessionResponse ToResponse(RestockSession session) =>
        new(session.Id, session.OpenedAt, session.ClosedAt, session.Note);

    private static MovementResponse ToResponse(StockMovement movement) =>
        new(movement.Id, movement.Sku, movement.Delta, movement.Reason.ToString(), movement.Timestamp, movement.ResultingQuantity, movement.SessionId);
}

public record OpenSessionRequest(string? Note);
public record RestockSessionResponse(Guid Id, DateTimeOffset OpenedAt, DateTimeOffset? ClosedAt, string? Note);
public record MovementResponse(Guid Id, string Sku, int Delta, string Reason, DateTimeOffset Timestamp, int ResultingQuantity, Guid? SessionId);
