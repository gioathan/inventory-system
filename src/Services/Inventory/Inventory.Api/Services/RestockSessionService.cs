using InventorySystem.Inventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Services;

public record SessionSummaryLine(string Sku, int Restocked, int Sold, int NetDelta);

// Shared by both the REST endpoints (direct/admin use) and the gRPC service (Dashboard's
// sessionReport query) so the aggregation logic exists exactly once.
public class RestockSessionService(InventoryDbContext db)
{
    public async Task<RestockSession> OpenAsync(string? note, CancellationToken cancellationToken)
    {
        // The partial unique index on ClosedAt IS NULL is the real guard against two open
        // sessions racing each other; this check just gives a friendlier error in the common case.
        if (await db.RestockSessions.AnyAsync(s => s.ClosedAt == null, cancellationToken))
            throw new InvalidOperationException("A restock session is already open. Close it before opening another.");

        var session = new RestockSession
        {
            Id = Guid.NewGuid(),
            OpenedAt = DateTimeOffset.UtcNow,
            Note = note
        };

        db.RestockSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return session;
    }

    public async Task<RestockSession?> CloseAsync(Guid id, CancellationToken cancellationToken)
    {
        var session = await db.RestockSessions.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (session is null)
            return null;

        if (session.ClosedAt is not null)
            throw new InvalidOperationException($"Session '{id}' is already closed.");

        session.ClosedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return session;
    }

    public Task<RestockSession?> GetCurrentAsync(CancellationToken cancellationToken) =>
        db.RestockSessions.AsNoTracking().FirstOrDefaultAsync(s => s.ClosedAt == null, cancellationToken);

    public Task<List<RestockSession>> ListAsync(CancellationToken cancellationToken) =>
        db.RestockSessions.AsNoTracking().OrderByDescending(s => s.OpenedAt).ToListAsync(cancellationToken);

    // Restocked = sum of positive deltas (Intake + Restock movements), Sold = sum of negative
    // deltas from Sale movements only — a ManualAdjust correction shouldn't be counted as a sale.
    public async Task<List<SessionSummaryLine>> GetSummaryAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        var grouped = await db.StockMovements.AsNoTracking()
            .Where(m => m.SessionId == sessionId)
            .GroupBy(m => m.Sku)
            .Select(g => new
            {
                Sku = g.Key,
                Restocked = g.Where(m => m.Delta > 0).Sum(m => m.Delta),
                Sold = g.Where(m => m.Reason == StockMovementReason.Sale && m.Delta < 0).Sum(m => -m.Delta),
                NetDelta = g.Sum(m => m.Delta)
            })
            .ToListAsync(cancellationToken);

        return grouped.Select(g => new SessionSummaryLine(g.Sku, g.Restocked, g.Sold, g.NetDelta)).ToList();
    }

    public Task<List<StockMovement>> GetMovementsAsync(
        string? sku, Guid? sessionId, DateTimeOffset? from, DateTimeOffset? to, CancellationToken cancellationToken)
    {
        var query = db.StockMovements.AsNoTracking().AsQueryable();

        if (sku is not null) query = query.Where(m => m.Sku == sku);
        if (sessionId is not null) query = query.Where(m => m.SessionId == sessionId);
        if (from is not null) query = query.Where(m => m.Timestamp >= from);
        if (to is not null) query = query.Where(m => m.Timestamp <= to);

        return query.OrderByDescending(m => m.Timestamp).ToListAsync(cancellationToken);
    }
}
