import { useTranslations } from "next-intl";
import type commonMessages from "@/messages/en/common.json";
import { stockLevel } from "./stock";
import type { CatalogEntry } from "./types";

export type ItemFilter = "all" | "low" | "out" | "promo";

// The four views of the catalog that Stock and Catalog both offer, defined once so a filter
// means the same thing on every screen.
export const ITEM_FILTERS: { id: ItemFilter; labelKey: `itemFilters.${keyof typeof commonMessages.itemFilters}`; matches: (item: CatalogEntry) => boolean }[] = [
  { id: "all", labelKey: "itemFilters.all", matches: () => true },
  { id: "low", labelKey: "itemFilters.low", matches: (item) => stockLevel(item.quantityOnHand) === "low" },
  { id: "out", labelKey: "itemFilters.out", matches: (item) => stockLevel(item.quantityOnHand) === "out" },
  { id: "promo", labelKey: "itemFilters.promo", matches: (item) => item.discountPercentage !== null },
];

// ITEM_FILTERS with each label resolved in the current UI language, ready for <FilterChips>.
export function useItemFilterOptions() {
  const t = useTranslations("common");
  return ITEM_FILTERS.map((f) => ({ id: f.id, label: t(f.labelKey) }));
}

export function matchesSearch(item: CatalogEntry, term: string, extra: string[] = []): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.sku, item.barcode, ...extra].some((field) => field.toLowerCase().includes(needle));
}
