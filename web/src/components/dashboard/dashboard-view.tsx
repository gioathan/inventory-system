"use client";

import { AlertTriangle, ArrowRight, Boxes, ClipboardList, PackagePlus, Tag } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { useAlerts } from "@/hooks/use-admin-data";
import { useItems } from "@/hooks/use-items";
import { useCurrentSession, useSessionReport } from "@/hooks/use-restock-sessions";
import { computeStats, needsAttention } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";
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
  const alerts = useAlerts();
  const session = useCurrentSession();
  const report = useSessionReport(session.data?.id ?? null);

  const stats = useMemo(() => (items.data ? computeStats(items.data) : null), [items.data]);
  const attention = useMemo(() => needsAttention(items.data ?? []), [items.data]);
  const itemBySku = useMemo(() => new Map((items.data ?? []).map((i) => [i.sku, i])), [items.data]);
  const sessionReceived = useMemo(() => (report.data ?? []).reduce((sum, l) => sum + l.restocked, 0), [report.data]);
  const topReceived = useMemo(
    () => [...(report.data ?? [])].filter((l) => l.restocked > 0).sort((a, b) => b.restocked - a.restocked).slice(0, 5),
    [report.data],
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
          <Link href="/restock-sessions" className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2")}>
            <ClipboardList className="size-4" />
            Restock sessions
          </Link>
          <Link href="/receive" className={cn(buttonVariants(), "h-10 gap-2")}>
            <PackagePlus className="size-4" />
            Receive stock
          </Link>
        </div>
      </div>

      {items.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load the overview: {items.error.message}
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
              <Kpi
                label="This session"
                value={session.data ? (report.isPending ? "…" : sessionReceived.toLocaleString()) : "—"}
                sub={session.data ? `units received since ${timeAgo(session.data.openedAt)}` : "No restock session open"}
                icon={ClipboardList}
              />
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
          title="Current restock session"
          action={
            <Link href="/restock-sessions" className="flex items-center gap-1 text-xs text-primary hover:underline">
              All sessions <ArrowRight className="size-3" />
            </Link>
          }
        >
          <PanelState
            pending={session.isPending || (!!session.data && report.isPending)}
            error={session.error ?? report.error}
            empty={!session.data || topReceived.length === 0}
            emptyText={session.data ? "Nothing received in this session yet." : "No session open. Start one from Receive stock when a delivery comes in."}
          />
          {session.data && topReceived.length > 0 && (
            <ul className="divide-y">
              {topReceived.map((line) => (
                <li key={line.sku} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{line.name ?? line.sku}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{line.sku}</div>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    +{line.restocked} received{line.sold > 0 ? ` · ${line.sold} sold` : ""}
                  </span>
                </li>
              ))}
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
