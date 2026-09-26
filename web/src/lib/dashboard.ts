import { stockLevel } from "./stock";
import type { PurchaseOrder } from "./po";
import { totals } from "./po";
import type { CatalogEntry } from "./types";

export interface DashboardStats {
  skus: number;
  onPromo: number;
  unitsOnHand: number;
  /** Stock at what customers currently pay (discounts included). Not cost: the backend has none. */
  retailValue: number;
  inStock: number;
  low: number;
  out: number;
  openOrders: number;
  unitsDue: number;
}

export function computeStats(items: CatalogEntry[], orders: PurchaseOrder[]): DashboardStats {
  let unitsOnHand = 0;
  let retailValue = 0;
  let inStock = 0, low = 0, out = 0, onPromo = 0;

  for (const item of items) {
    const quantity = item.quantityOnHand ?? 0;
    unitsOnHand += quantity;
    retailValue += quantity * item.effectivePrice;
    if (item.discountPercentage !== null) onPromo++;
    const level = stockLevel(item.quantityOnHand);
    if (level === "ok") inStock++;
    else if (level === "low") low++;
    else out++;
  }

  const open = orders.filter((o) => o.status === "Sent" || o.status === "PartiallyReceived");
  return {
    skus: items.length,
    onPromo,
    unitsOnHand,
    retailValue,
    inStock,
    low,
    out,
    openOrders: open.length,
    unitsDue: open.reduce((sum, o) => sum + totals(o).remaining, 0),
  };
}

// What needs reordering: low items, lowest first, then items that hit zero. Items that have never
// been stocked (quantity null) are deliberately left out — they're catalog entries nobody has
// received yet, not stock that ran out, and on a real catalog they'd bury the genuine shortages.
export function needsAttention(items: CatalogEntry[], limit = 8): CatalogEntry[] {
  return items
    .filter((i) => i.quantityOnHand !== null && stockLevel(i.quantityOnHand) !== "ok")
    .sort((a, b) => (a.quantityOnHand ?? 0) - (b.quantityOnHand ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
