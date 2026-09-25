"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, PackageSearch, RefreshCw, Search, Tag, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatPercent } from "@/lib/format";
import { gql } from "@/lib/graphql";
import { stockLevel } from "@/lib/stock";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const ITEMS_QUERY = /* GraphQL */ `
  query StockItems {
    items {
      sku
      name
      barcode
      price
      discountPercentage
      effectivePrice
      imageUrl
      categoryId
      quantityOnHand
    }
  }
`;

type Filter = "all" | "low" | "out" | "promo";

const FILTERS: { id: Filter; label: string; matches: (item: CatalogEntry) => boolean }[] = [
  { id: "all", label: "All", matches: () => true },
  { id: "low", label: "Low stock", matches: (item) => stockLevel(item.quantityOnHand) === "low" },
  { id: "out", label: "Out of stock", matches: (item) => stockLevel(item.quantityOnHand) === "out" },
  { id: "promo", label: "On promo", matches: (item) => item.discountPercentage !== null },
];

function StockCard({ item }: { item: CatalogEntry }) {
  const level = stockLevel(item.quantityOnHand);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex gap-3">
        <ItemImage src={item.imageUrl} alt={item.name} className="size-16" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-tight">{item.name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{item.sku}</p>
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
          <StatusPill tone="danger">{item.quantityOnHand === null ? "Not stocked yet" : "Out of stock"}</StatusPill>
        )}
        {level === "low" && <StatusPill tone="warning">Low · {item.quantityOnHand} left</StatusPill>}
        {level === "ok" && <StatusPill tone="success">{item.quantityOnHand} in stock</StatusPill>}
        <Link
          href={`/receive?barcode=${encodeURIComponent(item.barcode)}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-3")}
        >
          Receive
        </Link>
      </div>
    </li>
  );
}

export function StockLookup() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useQuery({
    queryKey: ["items"],
    queryFn: async () => (await gql<{ items: CatalogEntry[] }>(ITEMS_QUERY)).items,
  });

  // Desktop only: focusing on a touch device would pop the keyboard over the results.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }, []);

  const all = useMemo(() => items.data ?? [], [items.data]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter(f.matches).length])) as Record<Filter, number>,
    [all],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = FILTERS.find((f) => f.id === filter)!;
    return all
      .filter(active.matches)
      .filter((item) => !term || [item.name, item.sku, item.barcode].some((field) => field.toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, filter, search]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
          <p className="text-sm text-muted-foreground">Look up any item. A hardware scanner works in the search box too.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Refresh stock"
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
          aria-label="Search items"
          placeholder="Search by name, SKU or barcode"
          autoComplete="off"
          spellCheck={false}
          className="h-11 pl-9 pr-10"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
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

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
              filter === f.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-80">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {items.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading stock">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
      ) : items.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">Couldn&apos;t load stock: {items.error.message}</p>
          <Button type="button" variant="outline" onClick={() => items.refetch()}>
            {items.isFetching && <Loader2 className="size-4 animate-spin" />}
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <PackageSearch className="size-8 text-primary/70" />
          {all.length === 0 ? "No items in the catalog yet." : "No items match. Try a different search or filter."}
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? "item" : "items"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => (
              <StockCard key={item.sku} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
