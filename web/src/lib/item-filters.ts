import { stockLevel } from "./stock";
import type { CatalogEntry } from "./types";

export type ItemFilter = "all" | "low" | "out" | "promo";

// The four views of the catalog that Stock and Catalog both offer, defined once so a filter
// means the same thing on every screen.
export const ITEM_FILTERS: { id: ItemFilter; label: string; matches: (item: CatalogEntry) => boolean }[] = [
  { id: "all", label: "All", matches: () => true },
  { id: "low", label: "Low stock", matches: (item) => stockLevel(item.quantityOnHand) === "low" },
  { id: "out", label: "Out of stock", matches: (item) => stockLevel(item.quantityOnHand) === "out" },
  { id: "promo", label: "On promo", matches: (item) => item.discountPercentage !== null },
];

export function matchesSearch(item: CatalogEntry, term: string, extra: string[] = []): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.sku, item.barcode, ...extra].some((field) => field.toLowerCase().includes(needle));
}
