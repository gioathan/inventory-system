"use client";

import { Percent, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/checkbox";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useCategories, useItems } from "@/hooks/use-items";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CatalogEntry } from "@/lib/types";
import { DiscountDialog } from "./discount-dialog";

export function DiscountsView() {
  const items = useItems();
  const categories = useCategories();
  const [target, setTarget] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogItems, setDialogItems] = useState<CatalogEntry[] | null>(null);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const discounted = useMemo(
    () => all.filter((i) => i.discountPercentage !== null).sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );
  const targetItems = useMemo(() => (target === "all" ? all : all.filter((i) => i.categoryId === target)), [all, target]);
  const selectedItems = discounted.filter((i) => selected.has(i.sku));
  const allSelected = discounted.length > 0 && selectedItems.length === discounted.length;

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of all) if (item.categoryId) map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    return map;
  }, [all]);

  function toggle(sku: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Discounts &amp; Promos</h1>
        <p className="text-sm text-muted-foreground">
          Put a percentage off many items at once for a sale period. List prices never change, so ending a promo restores them exactly.
        </p>
      </div>

      <section aria-label="Apply a discount" className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-end sm:p-5">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="discount-target" className="text-sm font-medium">
            Apply to
          </label>
          <NativeSelect id="discount-target" value={target} onChange={(event) => setTarget(event.target.value)} disabled={items.isPending}>
            <option value="all">All items ({all.length})</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({categoryCounts.get(c.id) ?? 0})
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" className="h-11 gap-2" disabled={targetItems.length === 0} onClick={() => setDialogItems(targetItems)}>
          <Percent className="size-4" />
          Set discount for {targetItems.length} {targetItems.length === 1 ? "item" : "items"}
        </Button>
      </section>

      <section aria-label="Active promotions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Checkbox
              aria-label="Select all promotions"
              checked={allSelected}
              indeterminate={selectedItems.length > 0 && !allSelected}
              disabled={discounted.length === 0}
              onChange={() => setSelected(allSelected ? new Set() : new Set(discounted.map((i) => i.sku)))}
            />
            <h2 className="text-sm font-medium">Active promotions ({discounted.length})</h2>
          </div>
          {selectedItems.length > 0 && (
            <Button type="button" variant="outline" className="h-9" onClick={() => setDialogItems(selectedItems)}>
              Change or remove {selectedItems.length} selected
            </Button>
          )}
        </div>

        {items.isPending ? (
          <div className="h-32 animate-pulse rounded-2xl border bg-muted/40" aria-label="Loading promotions" />
        ) : items.isError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Couldn&apos;t load items: {items.error.message}
          </p>
        ) : discounted.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <Tag className="size-6 text-primary/70" />
            No promotions running. Set a discount above to start one.
          </div>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {discounted.map((item) => (
              <li key={item.sku} className="flex items-center gap-3 px-4 py-3">
                <Checkbox aria-label={`Select ${item.name}`} checked={selected.has(item.sku)} onChange={() => toggle(item.sku)} />
                <ItemImage src={item.imageUrl} alt="" className="size-11 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{item.sku}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill tone="warning" className="px-2 py-0.5">
                    {formatPercent(item.discountPercentage!)} off
                  </StatusPill>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    <span className="line-through">{formatMoney(item.price)}</span>{" "}
                    <span className="font-medium text-foreground">{formatMoney(item.effectivePrice)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DiscountDialog
        open={dialogItems !== null}
        onOpenChange={(open) => !open && setDialogItems(null)}
        items={dialogItems ?? []}
        onDone={() => setSelected(new Set())}
      />
    </div>
  );
}
