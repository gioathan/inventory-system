"use client";

import { Loader2, Plus, Search, Truck, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FilterChips } from "@/components/filter-chips";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { formatDate, PO_FILTERS, PO_STATUS, shortId, totals, type PoFilter, type PurchaseOrder } from "@/lib/po";
import { cn } from "@/lib/utils";

function PoCard({ order }: { order: PurchaseOrder }) {
  const status = PO_STATUS[order.status];
  const { ordered, received } = totals(order);
  return (
    <li>
      <Link
        href={`/purchase-orders/${order.id}`}
        className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:border-primary"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{order.supplierName}</h3>
            <p className="font-mono text-xs text-muted-foreground">{shortId(order.id)}</p>
          </div>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>

        <div className="flex flex-col gap-1.5">
          <ProgressBar value={received} max={ordered} label={`${shortId(order.id)} received units`} />
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {received} of {ordered} units
            </span>
            <span>
              {order.lines.length} {order.lines.length === 1 ? "line" : "lines"}
            </span>
          </div>
        </div>

        <p className="mt-auto text-xs text-muted-foreground">
          Opened {formatDate(order.openedAt)}
          {order.closedAt && ` · closed ${formatDate(order.closedAt)}`}
        </p>
      </Link>
    </li>
  );
}

export function PoList() {
  const orders = usePurchaseOrders();
  const [filter, setFilter] = useState<PoFilter>("all");
  const [search, setSearch] = useState("");

  const all = useMemo(() => orders.data ?? [], [orders.data]);

  const counts = useMemo(() => {
    const result = { all: all.length, Draft: 0, Sent: 0, PartiallyReceived: 0, Received: 0, Cancelled: 0 } satisfies Record<PoFilter, number>;
    for (const order of all) result[order.status]++;
    return result;
  }, [all]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((o) => filter === "all" || o.status === filter)
      .filter((o) => !term || o.supplierName.toLowerCase().includes(term) || shortId(o.id).toLowerCase().includes(term))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }, [all, filter, search]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
          <p className="text-sm text-muted-foreground">What you&apos;ve ordered from suppliers and what has arrived.</p>
        </div>
        <Link href="/purchase-orders/new" className={cn(buttonVariants(), "h-10 gap-2")}>
          <Plus className="size-4" />
          New purchase order
        </Link>
      </div>

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search purchase orders"
          placeholder="Search by supplier or order number"
          autoComplete="off"
          className="h-11 pl-9 pr-10"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <FilterChips options={PO_FILTERS} value={filter} onChange={setFilter} counts={counts} />

      {orders.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading purchase orders">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
      ) : orders.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">Couldn&apos;t load purchase orders: {orders.error.message}</p>
          <Button type="button" variant="outline" onClick={() => orders.refetch()}>
            {orders.isFetching && <Loader2 className="size-4 animate-spin" />}
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Truck className="size-8 text-primary/70" />
          {all.length === 0 ? "No purchase orders yet. Create one when you order from a supplier." : "No orders match. Try a different search or filter."}
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? "order" : "orders"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((order) => (
              <PoCard key={order.id} order={order} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
