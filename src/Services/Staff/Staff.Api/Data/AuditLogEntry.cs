namespace InventorySystem.Staff.Api.Data;

// Username is denormalized (copied, not just referenced by UserId) so the log stays readable
// even for events with no user at all (a failed login against an unknown username) or if a
// user were ever removed later — the log shouldn't need a join to say who did what.
public class AuditLogEntry
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }
    public required string Username { get; set; }
    public required string Action { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? Details { get; set; }
}
