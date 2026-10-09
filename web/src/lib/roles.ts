import type { Role } from "./jwt";

// Where each role lands after login. Admins also have access to the seller screens (the
// backend's SellerOrAdmin policy includes them), but their home is the operations dashboard.
// Receiving stock is admin-only: it sits with the seller screens in the UI (same shell, used
// on the shop floor), but sellers neither see it nor can open it.
export function homeFor(role: Role): string {
  return role === "Admin" ? "/dashboard" : "/scan";
}

export const ADMIN_PREFIXES = ["/dashboard", "/catalog", "/categories", "/discounts", "/restock-sessions", "/staff", "/audit-log", "/labels", "/receive"];
export const SELLER_PREFIXES = ["/scan", "/stock"];

export function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
