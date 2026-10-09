namespace InventorySystem.Auth.Contracts;

// "SellerOrAdmin" is the floor for day-to-day staff actions (scan, sell, stock lookup) —
// Admin can do anything Seller can. "AdminOnly" gates everything else: receiving stock and
// creating items, plus categories, restock sessions, reports, alerts and staff management.
public static class AuthPolicies
{
    public const string SellerOrAdmin = "SellerOrAdmin";
    public const string AdminOnly = "AdminOnly";
}
