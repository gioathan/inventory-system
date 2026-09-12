namespace InventorySystem.Inventory.Api.Data;

// Only one session may be open (ClosedAt == null) at a time — every receive/adjust made while
// a session is open is auto-tagged with it, so callers never need to pass a SessionId themselves.
public class RestockSession
{
    public Guid Id { get; set; }
    public DateTimeOffset OpenedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public string? Note { get; set; }
}
