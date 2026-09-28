using InventorySystem.Inventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Inventory.Api.Services;

public record SessionSummaryLine(
    string Sku, int Restocked, int Sold, int NetDelta, int OpeningQuantity, int ClosingQuantity,
    decimal RecordedRevenue, int UnpricedSold);

// Shared by both the REST endpoints (direct/admin use) and the gRPC service (Dashboard's
// sessionReport query) so the aggregation logic exists exactly once.
public class RestockSessionService(InventoryDbContext db)
{
    // Starting a new session closes whichever one is open, at the same instant — a restocking
    // period ends when the next one begins, so there's never a forgotten session left open.
    // Two saves inside one transaction, not one: the partial unique index on ClosedAt IS NULL is
    // checked per statement, and EF doesn't promise to order an unrelated UPDATE before an
    // INSERT, so the close has to hit the database before the new row does. Two admins starting
    // a session at the same moment still can't both win — the loser's insert trips that index.
    public Task<(RestockSession Opened, RestockSession? Closed)> OpenAsync(string? note, CancellationToken cancellationToken) =>
        // Same wrapping as StockReceivingService's manual transactions, so this keeps working if
        // retry-on-failure is ever turned back on for this DbContext (see Program.cs).
        db.Database.CreateExecutionStrategy().ExecuteAsync(() => OpenInTransactionAsync(note, cancellationToken));

    private async Task<(RestockSession Opened, RestockSession? Closed)> OpenInTransactionAsync(string? note, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var previous = await db.RestockSessions.FirstOrDefaultAsync(s => s.ClosedAt == null, cancellationToken);
        if (previous is not null)
        {
            previous.ClosedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        var session = new RestockSession
        {
            Id = Guid.NewGuid(),
            OpenedAt = now,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim()
        };
        db.RestockSessions.Add(session);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
        {
            throw new InvalidOperationException("Someone else started a restock session at the same moment. Reload to see it.");
        }

        await transaction.CommitAsync(cancellationToken);
        return (session, previous);
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

    // The session's own period: from OpenedAt until ClosedAt, or until now while it's still open.
    // Every movement made while a session is open (receives, sales, corrections) is also tagged
    // with its SessionId, and since starting a session closes the previous one, sessions never
    // overlap — so bounding by time and filtering by tag give the same answer. Time is kept
    // because it's what this query has always used and it needs no extra index.
    // Restocked = sum of positive deltas (Intake + Restock movements), Sold = sum of negative
    // deltas from Sale movements only — a ManualAdjust correction shouldn't be counted as a sale.
    public async Task<List<SessionSummaryLine>?> GetSummaryAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        var session = await db.RestockSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        if (session is null)
            return null;

        var inSession = db.StockMovements.AsNoTracking().Where(m => m.Timestamp >= session.OpenedAt);
        if (session.ClosedAt is { } closedAt)
            inSession = inSession.Where(m => m.Timestamp < closedAt);

        var grouped = await inSession
            .GroupBy(m => m.Sku)
            .Select(g => new
            {
                Sku = g.Key,
                Restocked = g.Where(m => m.Delta > 0).Sum(m => m.Delta),
                Sold = g.Where(m => m.Reason == StockMovementReason.Sale && m.Delta < 0).Sum(m => -m.Delta),
                NetDelta = g.Sum(m => m.Delta),
                // Sales that carry the price actually paid, and the units sold before prices were
                // recorded — the caller estimates those from today's price and says so.
                RecordedRevenue = g.Where(m => m.Reason == StockMovementReason.Sale && m.Delta < 0 && m.UnitPrice != null)
                    .Sum(m => -m.Delta * m.UnitPrice!.Value),
                UnpricedSold = g.Where(m => m.Reason == StockMovementReason.Sale && m.Delta < 0 && m.UnitPrice == null)
                    .Sum(m => -m.Delta)
            })
            .ToListAsync(cancellationToken);

        // Stock at the end of the period is the ResultingQuantity of each item's last movement in
        // it; stock at the start follows as end − net change, since every quantity change is in
        // the ledger. (A correlated NOT EXISTS, served by the Sku+Timestamp index.)
        var lastMovements = await inSession
            .Where(m => !inSession.Any(later => later.Sku == m.Sku && later.Timestamp > m.Timestamp))
            .Select(m => new { m.Sku, m.ResultingQuantity })
            .ToListAsync(cancellationToken);
        var closingBySku = lastMovements.GroupBy(m => m.Sku).ToDictionary(g => g.Key, g => g.First().ResultingQuantity);

        return grouped.Select(g =>
        {
            var closing = closingBySku.GetValueOrDefault(g.Sku);
            return new SessionSummaryLine(g.Sku, g.Restocked, g.Sold, g.NetDelta, closing - g.NetDelta, closing, g.RecordedRevenue, g.UnpricedSold);
        }).ToList();
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
