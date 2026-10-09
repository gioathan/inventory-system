"use client";

import { ListFilter, Percent, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/checkbox";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useCategoryTree, useItems } from "@/hooks/use-items";
import { countItems } from "@/lib/categories";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DatedDiscountsSection } from "./dated-discounts";
import { DiscountDialog } from "./discount-dialog";

export function DiscountsView() {
  const t = useTranslations("discounts");
  // ?dated=new&sku=… (from the Catalog's selection bar) opens the dated-discount form with those items.
  const params = useSearchParams();
  const items = useItems();
  const tree = useCategoryTree();
  const [target, setTarget] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogItems, setDialogItems] = useState<CatalogEntry[] | null>(null);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const discounted = useMemo(
    () => all.filter((i) => i.discountPercentage !== null).sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );
  // A category means everything beneath it too: discounting Jewelry discounts Earrings.
  const targetItems = useMemo(() => {
    if (target === "all") return all;
    const within = tree.withDescendants(target);
    return all.filter((i) => i.categoryId !== null && within.has(i.categoryId));
  }, [all, target, tree]);
  const selectedItems = discounted.filter((i) => selected.has(i.sku));
  const allSelected = discounted.length > 0 && selectedItems.length === discounted.length;

  const categoryCounts = useMemo(() => countItems(tree, all), [tree, all]);

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section aria-label={t("applySection")}className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-end sm:p-5">
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="discount-target" className="text-sm font-medium">
              {t("applyTo")}
            </label>
            <Link
              href="/catalog"
              className={cn(buttonVariants({ variant: "link" }), "h-auto gap-1.5 p-0 text-sm text-muted-foreground hover:text-foreground")}
            >
              <ListFilter className="size-3.5" />
              {t("pickSpecific")}
            </Link>
          </div>
          <Combobox
            id="discount-target"
            value={target}
            onValueChange={setTarget}
            disabled={items.isPending}
            options={[
              { value: "all", label: t("allItems", { count: all.length }) },
              ...tree.nested.map(({ category: c }) => ({ value: c.id, label: `${tree.pathLabel(c.id)} (${categoryCounts.total(c.id)})` })),
            ]}
          />
        </div>
        <Button type="button" className="h-11 gap-2" disabled={targetItems.length === 0} onClick={() => setDialogItems(targetItems)}>
          <Percent className="size-4" />
          {t("setDiscountFor", { count: targetItems.length })}
        </Button>
      </section>

      <section aria-label={t("activeSection")} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Checkbox
              aria-label={t("selectAll")}
              checked={allSelected}
              indeterminate={selectedItems.length > 0 && !allSelected}
              disabled={discounted.length === 0}
              onChange={() => setSelected(allSelected ? new Set() : new Set(discounted.map((i) => i.sku)))}
            />
            <h2 className="text-sm font-medium">{t("activeCount", { count: discounted.length })}</h2>
          </div>
          {selectedItems.length > 0 && (
            <Button type="button" variant="outline" className="h-9" onClick={() => setDialogItems(selectedItems)}>
              {t("changeSelected", { count: selectedItems.length })}
            </Button>
          )}
        </div>

        {items.isPending ? (
          <div className="h-32 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loading")} />
        ) : items.isError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t("loadError", { message: items.error.message })}
          </p>
        ) : discounted.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <Tag className="size-6 text-primary/70" />
            {t("empty")}
          </div>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {discounted.map((item) => (
              <li key={item.sku} className="flex items-center gap-3 px-4 py-3">
                <Checkbox aria-label={t("selectItem", { name: item.name })} checked={selected.has(item.sku)} onChange={() => toggle(item.sku)} />
                <ItemImage src={item.imageUrl} alt="" className="size-11 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{item.sku}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill tone="warning" className="px-2 py-0.5">
                    {t("percentOff", { percent: formatPercent(item.discountPercentage!) })}
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

      <DatedDiscountsSection prefillSkus={params.get("dated") === "new" ? params.getAll("sku") : undefined} />

      <DiscountDialog
        open={dialogItems !== null}
        onOpenChange={(open) => !open && setDialogItems(null)}
        items={dialogItems ?? []}
        onDone={() => setSelected(new Set())}
      />
    </div>
  );
}
