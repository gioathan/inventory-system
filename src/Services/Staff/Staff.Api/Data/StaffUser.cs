namespace InventorySystem.Staff.Api.Data;

// Role is a plain string (matching InventorySystem.Auth.Contracts.StaffRoles) rather than an
// enum: it needs to come out byte-for-byte identical to the "role" claim JwtTokenFactory puts
// in the token, and a shared string constant is fewer moving parts than an enum <-> claim-string
// mapping that could drift out of sync.
public class StaffUser
{
    public Guid Id { get; set; }
    public required string Username { get; set; }
    public required string PasswordHash { get; set; }
    public required string Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
