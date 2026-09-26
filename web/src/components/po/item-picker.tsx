"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ItemImage } from "@/components/item-image";
import { Input } from "@/components/ui/input";
import { useItems } from "@/hooks/use-items";
import { matchesSearch } from "@/lib/item-filters";
import type { CatalogEntry } from "@/lib/types";

const MAX_RESULTS = 8;

// A search box, not a dropdown: a catalog can hold thousands of items, and nobody scrolls a
// select that long. Type a name, SKU or barcode, click (or press Enter for the first match).
export function ItemPicker({ excluded, onPick }: { excluded: string[]; onPick: (item: CatalogEntry) => void }) {
  const items = useItems();
  const [term, setTerm] = useState("");

  const results = useMemo(() => {
    if (!term.trim()) return [];
    const taken = new Set(excluded);
    return (items.data ?? []).filter((i) => !taken.has(i.sku) && matchesSearch(i, term)).slice(0, MAX_RESULTS);
  }, [items.data, term, excluded]);

  function pick(item: CatalogEntry) {
    onPick(item);
    setTerm("");
  }

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault(); // Enter here means "pick", never "submit the whole order"
            if (results[0]) pick(results[0]);
          }
        }}
        aria-label="Add an item"
        placeholder={items.isPending ? "Loading items…" : "Search items to add by name, SKU or barcode"}
        autoComplete="off"
        spellCheck={false}
        className="h-11 pl-9"
      />

      {term.trim() && (
        <ul
          aria-label="Matching items"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">No matching items{excluded.length ? " (or already added)" : ""}.</li>
          ) : (
            results.map((item) => (
              <li key={item.sku}>
                <button
                  type="button"
                  onClick={() => pick(item)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <ItemImage src={item.imageUrl} alt="" className="size-9 rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{item.sku}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.quantityOnHand ?? 0} on hand</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
