namespace InventorySystem.Auth.Contracts;

// "SellerOrAdmin" is the floor for day-to-day staff actions (scan, sell, intake, receive) —
// Admin can do anything Seller can. "AdminOnly" gates the genuinely sensitive/rare actions
// (categories, restock sessions, reports, alerts, staff management).
public static class AuthPolicies
{
    public const string SellerOrAdmin = "SellerOrAdmin";
    public const string AdminOnly = "AdminOnly";
}
