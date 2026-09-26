"use client";

import { AlertTriangle, ArrowRight, Boxes, PackagePlus, Plus, Tag, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ItemImage } from "@/components/item-image";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill } from "@/components/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { useAlerts } from "@/hooks/use-admin-data";
import { useItems } from "@/hooks/use-items";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { computeStats, needsAttention } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";
import { PO_STATUS, shortId, totals } from "@/lib/po";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelState({ pending, error, empty, emptyText }: { pending: boolean; error?: Error | null; empty: boolean; emptyText: string }) {
  if (pending) return <div className="h-28 animate-pulse rounded-xl bg-muted/40" aria-label="Loading" />;
  if (error) return <p role="alert" className="text-sm text-destructive">Couldn&apos;t load this: {error.message}</p>;
  if (empty) return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return null;
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub: string; icon: typeof Boxes; tone?: "warning" }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        <Icon className={cn("size-4", tone === "warning" ? "text-warning" : "text-primary/70")} />
      </div>
      <div className={cn("text-3xl font-semibold tabular-nums tracking-tight", tone === "warning" && "text-warning")}>{value}</div>
      <div className="text-xs tabular-nums text-muted-foreground">{sub}</div>
    </div>
  );
}

export function DashboardView() {
  const items = useItems();
  const orders = usePurchaseOrders();
  const alerts = useAlerts();

  const stats = useMemo(() => (items.data && orders.data ? computeStats(items.data, orders.data) : null), [items.data, orders.data]);
  const attention = useMemo(() => needsAttention(items.data ?? []), [items.data]);
  const itemBySku = useMemo(() => new Map((items.data ?? []).map((i) => [i.sku, i])), [items.data]);
  const openOrders = useMemo(
    () =>
      (orders.data ?? [])
        .filter((o) => o.status === "Sent" || o.status === "PartiallyReceived")
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
        .slice(0, 5),
    [orders.data],
  );

  const health = stats && stats.skus > 0 ? [
    { key: "ok", label: "In stock", value: stats.inStock, className: "bg-success" },
    { key: "low", label: "Low", value: stats.low, className: "bg-warning" },
    { key: "out", label: "Out", value: stats.out, className: "bg-destructive" },
  ] : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground">Where stock stands and what needs your attention.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/receive" className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2")}>
            <PackagePlus className="size-4" />
            Receive stock
          </Link>
          <Link href="/purchase-orders/new" className={cn(buttonVariants(), "h-10 gap-2")}>
            <Plus className="size-4" />
            New purchase order
          </Link>
        </div>
      </div>

      {items.isError || orders.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load the overview: {(items.error ?? orders.error)?.message}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats ? (
            <>
              <Kpi label="Items" value={stats.skus.toLocaleString()} sub={`${stats.onPromo} on promo`} icon={Tag} />
              <Kpi label="Units on hand" value={stats.unitsOnHand.toLocaleString()} sub={`${formatMoney(stats.retailValue)} at retail`} icon={Boxes} />
              <Kpi
                label="Low stock"
                value={stats.low.toLocaleString()}
                sub={`${stats.out.toLocaleString()} out of stock`}
                icon={AlertTriangle}
                tone={stats.low > 0 ? "warning" : undefined}
              />
              <Kpi label="Open orders" value={String(stats.openOrders)} sub={`${stats.unitsDue.toLocaleString()} units still due`} icon={Truck} />
            </>
          ) : (
            Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border bg-muted/40" aria-label="Loading" />)
          )}
        </div>
      )}

      {health && (
        <Panel title="Stock health">
          <div role="img" aria-label={`${health[0].value} in stock, ${health[1].value} low, ${health[2].value} out of stock`} className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {health.map((h) => (
              <div key={h.key} className={h.className} style={{ width: `${(h.value / stats!.skus) * 100}%` }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {health.map((h) => (
              <li key={h.key} className="flex items-center gap-2 text-muted-foreground">
                <span aria-hidden className={cn("size-2.5 rounded-full", h.className)} />
                {h.label} <span className="font-medium tabular-nums text-foreground">{h.value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Needs attention"
          action={
            <Link href="/stock" className="flex items-center gap-1 text-xs text-primary hover:underline">
              All stock <ArrowRight className="size-3" />
            </Link>
          }
        >
          <PanelState pending={items.isPending} error={items.error} empty={attention.length === 0} emptyText="Nothing is running low. Stock levels look healthy." />
          {attention.length > 0 && (
            <ul className="divide-y">
              {attention.map((item) => (
                <li key={item.sku} className="flex items-center gap-3 py-2.5">
                  <ItemImage src={item.imageUrl} alt="" className="size-10 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{item.sku}</div>
                  </div>
                  <StatusPill tone={item.quantityOnHand === 0 ? "danger" : "warning"}>
                    {item.quantityOnHand === 0 ? "Out" : `${item.quantityOnHand} left`}
                  </StatusPill>
                  <Link href={`/receive?barcode=${encodeURIComponent(item.barcode)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-3")}>
                    Receive
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Open purchase orders"
          action={
            <Link href="/purchase-orders" className="flex items-center gap-1 text-xs text-primary hover:underline">
              All orders <ArrowRight className="size-3" />
            </Link>
          }
        >
          <PanelState pending={orders.isPending} error={orders.error} empty={openOrders.length === 0} emptyText="No orders are waiting on a delivery." />
          {openOrders.length > 0 && (
            <ul className="divide-y">
              {openOrders.map((order) => {
                const { ordered, received } = totals(order);
                return (
                  <li key={order.id}>
                    <Link href={`/purchase-orders/${order.id}`} className="flex flex-col gap-2 py-3 hover:opacity-90">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">{order.supplierName}</span>
                        <StatusPill tone={PO_STATUS[order.status].tone}>{PO_STATUS[order.status].label}</StatusPill>
                      </div>
                      <ProgressBar value={received} max={ordered} label={`${shortId(order.id)} received units`} />
                      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                        <span>{received} of {ordered} units</span>
                        <span className="font-mono">{shortId(order.id)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent low-stock alerts">
        <PanelState pending={alerts.isPending} error={alerts.error} empty={(alerts.data ?? []).length === 0} emptyText="No low-stock alerts have been raised yet." />
        {(alerts.data ?? []).length > 0 && (
          <ul className="divide-y">
            {(alerts.data ?? []).slice(0, 6).map((alert, index) => {
              const item = itemBySku.get(alert.sku);
              return (
                <li key={`${alert.sku}-${alert.timestamp}-${index}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item?.name ?? alert.sku}</div>
                    <div className="text-xs text-muted-foreground">
                      Dropped to {alert.quantityOnHand} (alerts at {alert.threshold} or fewer)
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(alert.timestamp)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
