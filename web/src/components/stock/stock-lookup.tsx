"use client";

import { Loader2, PackageSearch, RefreshCw, Search, Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterChips } from "@/components/filter-chips";
import { ItemImage } from "@/components/item-image";
import { QuickReceiveDialog } from "@/components/receive/quick-receive-dialog";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useItems } from "@/hooks/use-items";
import { useCurrentSessionSales } from "@/hooks/use-restock-sessions";
import { formatMoney, formatPercent } from "@/lib/format";
import { ITEM_FILTERS as FILTERS, matchesSearch, useItemFilterOptions, type ItemFilter as Filter } from "@/lib/item-filters";
import { stockLevel } from "@/lib/stock";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

function StockCard({
  item,
  soldThisSession,
  onReceive,
}: {
  item: CatalogEntry;
  soldThisSession: number | null;
  onReceive: (item: CatalogEntry) => void;
}) {
  const t = useTranslations("stock.card");
  const tc = useTranslations("common");
  const level = stockLevel(item.quantityOnHand);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex gap-3">
        <ItemImage src={item.imageUrl} alt={item.name} className="size-16" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-tight">{item.name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{item.sku}</p>
          {soldThisSession !== null && <p className="mt-0.5 text-xs text-muted-foreground">{t("soldThisSession", { count: soldThisSession })}</p>}
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-lg font-semibold tabular-nums">{formatMoney(item.effectivePrice)}</span>
            {item.discountPercentage !== null && (
              <>
                <span className="text-xs tabular-nums text-muted-foreground line-through">{formatMoney(item.price)}</span>
                <StatusPill tone="warning" className="px-2 py-0.5">
                  <Tag className="size-3" />
                  {formatPercent(item.discountPercentage)}
                </StatusPill>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {level === "out" && (
          <StatusPill tone="danger">{item.quantityOnHand === null ? tc("stockLevel.notStockedYet") : tc("stockLevel.outOfStock")}</StatusPill>
        )}
        {level === "low" && <StatusPill tone="warning">{t("lowLeft", { count: item.quantityOnHand ?? 0 })}</StatusPill>}
        {level === "ok" && <StatusPill tone="success">{t("inStock", { count: item.quantityOnHand ?? 0 })}</StatusPill>}
        <Button type="button" variant="outline" size="sm" className="h-9 px-3" onClick={() => onReceive(item)}>
          {t("receive")}
        </Button>
      </div>
    </li>
  );
}

export function StockLookup() {
  const t = useTranslations("stock");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useItems();
  // Counts only, readable by sellers; null per item when no session is open.
  const sessionSales = useCurrentSessionSales();
  const soldOf = (sku: string) => (sessionSales.data?.session ? (sessionSales.data.bySku.get(sku)?.sold ?? 0) : null);
  // Receiving happens in a dialog so the search and filter stay put for the next item.
  const [receiving, setReceiving] = useState<CatalogEntry | null>(null);

  // Desktop only: focusing on a touch device would pop the keyboard over the results.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }, []);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const filterOptions = useItemFilterOptions();

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter(f.matches).length])) as Record<Filter, number>,
    [all],
  );

  const visible = useMemo(() => {
        const active = FILTERS.find((f) => f.id === filter)!;
    return all
      .filter(active.matches)
      .filter((item) => matchesSearch(item, search))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, filter, search]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("refresh")}
          className="size-10 shrink-0"
          onClick={() => items.refetch()}
          disabled={items.isFetching}
        >
          <RefreshCw className={cn("size-4", items.isFetching && "animate-spin")} />
        </Button>
      </div>

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className="h-11 pl-9 pr-10"
        />
        {search && (
          <button
            type="button"
            aria-label={t("clearSearch")}
            onClick={() => {
              setSearch("");
              searchRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <FilterChips options={filterOptions} value={filter} onChange={setFilter} counts={counts} />

      {items.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("loading")}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
      ) : items.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">{t("loadFailed", { error: items.error.message })}</p>
          <Button type="button" variant="outline" onClick={() => items.refetch()}>
            {items.isFetching && <Loader2 className="size-4 animate-spin" />}
            {t("tryAgain")}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <PackageSearch className="size-8 text-primary/70" />
          {all.length === 0 ? t("emptyCatalog") : t("noMatches")}
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t("itemCount", { count: visible.length })}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => (
              <StockCard key={item.sku} item={item} soldThisSession={soldOf(item.sku)} onReceive={setReceiving} />
            ))}
          </ul>
        </>
      )}

      <QuickReceiveDialog open={receiving !== null} onOpenChange={(open) => !open && setReceiving(null)} items={receiving ? [receiving] : []} />
    </div>
  );
}
