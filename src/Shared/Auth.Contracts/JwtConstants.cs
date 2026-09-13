namespace InventorySystem.Auth.Contracts;

// Issuer/Audience are fixed, non-secret labels shared by every service — no need to plumb them
// through Aspire like the signing key, they're just agreed-upon constants. The signing key
// itself comes from configuration ("Jwt:SigningKey"), injected identically into every service
// via an Aspire parameter (see AppHost.cs) so token validation actually agrees everywhere.
public static class JwtConstants
{
    public const string Issuer = "inventory-system";
    public const string Audience = "inventory-system-clients";
    public const string SigningKeyConfigKey = "Jwt:SigningKey";

    // A work-shift-length lifetime — long enough that a seller doesn't get logged out mid-shift,
    // short enough that a stolen token doesn't stay valid indefinitely. No refresh tokens for
    // this practice project; re-login once it expires.
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(8);
}
