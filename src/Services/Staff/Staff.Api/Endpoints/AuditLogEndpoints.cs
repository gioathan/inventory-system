using InventorySystem.Auth.Contracts;
using InventorySystem.Staff.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InventorySystem.Staff.Api.Endpoints;

public static class AuditLogEndpoints
{
    public static void MapAuditLogEndpoints(this WebApplication app)
    {
        app.MapGet("/audit-log", async (StaffDbContext db, CancellationToken cancellationToken) =>
        {
            var entries = await db.AuditLogEntries.AsNoTracking()
                .OrderByDescending(e => e.Timestamp)
                .Take(200)
                .Select(e => new AuditLogEntryResponse(e.Id, e.Username, e.Action, e.Timestamp, e.Details))
                .ToListAsync(cancellationToken);
            return Results.Ok(entries);
        }).RequireAuthorization(AuthPolicies.AdminOnly);
    }
}

public record AuditLogEntryResponse(Guid Id, string Username, string Action, DateTimeOffset Timestamp, string? Details);
