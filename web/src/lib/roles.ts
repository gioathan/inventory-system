import type { Role } from "./jwt";

// Where each role lands after login. Admins also have access to the seller screens (the
// backend's SellerOrAdmin policy includes them), but their home is the operations dashboard.
export function homeFor(role: Role): string {
  return role === "Admin" ? "/dashboard" : "/scan";
}

export const ADMIN_PREFIXES = ["/dashboard", "/catalog", "/categories", "/discounts", "/purchase-orders", "/staff", "/audit-log", "/labels"];
export const SELLER_PREFIXES = ["/scan", "/receive", "/stock"];

export function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
