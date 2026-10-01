"use client";

import { AlertTriangle, ArrowRight, Boxes, ClipboardList, PackagePlus, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ItemImage } from "@/components/item-image";
import { QuickReceiveDialog } from "@/components/receive/quick-receive-dialog";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAlerts } from "@/hooks/use-admin-data";
import { useItems } from "@/hooks/use-items";
import { useCurrentSession, useSessionReport } from "@/hooks/use-restock-sessions";
import { computeStats, needsAttention } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";
import { useTimeFormat } from "@/lib/time";
import type { CatalogEntry } from "@/lib/types";
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
  const t = useTranslations("dashboard");
  if (pending) return <div className="h-28 animate-pulse rounded-xl bg-muted/40" aria-label={t("loading")} />;
  if (error) return <p role="alert" className="text-sm text-destructive">{t("loadError", { message: error.message })}</p>;
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
  // Receive in a dialog: the list refreshes and the next item that needs attention is right there.
  const [receiving, setReceiving] = useState<CatalogEntry | null>(null);
  const session = useCurrentSession();
  const report = useSessionReport(session.data?.id ?? null);
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const { timeAgo } = useTimeFormat();

  const stats = useMemo(() => (items.data ? computeStats(items.data) : null), [items.data]);
  const attention = useMemo(() => needsAttention(items.data ?? []), [items.data]);
  const itemBySku = useMemo(() => new Map((items.data ?? []).map((i) => [i.sku, i])), [items.data]);
  const sessionReceived = useMemo(() => (report.data ?? []).reduce((sum, l) => sum + l.restocked, 0), [report.data]);
  const topReceived = useMemo(
    () => [...(report.data ?? [])].filter((l) => l.restocked > 0).sort((a, b) => b.restocked - a.restocked).slice(0, 5),
    [report.data],
  );

  const health = stats && stats.skus > 0 ? [
    { key: "ok", label: tc("stockLevel.inStock"), value: stats.inStock, className: "bg-success" },
    { key: "low", label: t("health.low"), value: stats.low, className: "bg-warning" },
    { key: "out", label: t("health.out"), value: stats.out, className: "bg-destructive" },
  ] : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/restock-sessions" className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2")}>
            <ClipboardList className="size-4" />
            {t("actions.restockSessions")}
          </Link>
          <Link href="/receive" className={cn(buttonVariants(), "h-10 gap-2")}>
            <PackagePlus className="size-4" />
            {t("actions.receiveStock")}
          </Link>
        </div>
      </div>

      {items.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("overviewError", { message: items.error.message })}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats ? (
            <>
              <Kpi label={t("kpi.items")} value={stats.skus.toLocaleString()} sub={t("kpi.onPromo", { count: String(stats.onPromo) })} icon={Tag} />
              <Kpi
                label={t("kpi.unitsOnHand")}
                value={stats.unitsOnHand.toLocaleString()}
                sub={t("kpi.atRetail", { value: formatMoney(stats.retailValue) })}
                icon={Boxes}
              />
              <Kpi
                label={tc("stockLevel.lowStock")}
                value={stats.low.toLocaleString()}
                sub={t("kpi.outOfStock", { count: stats.out.toLocaleString() })}
                icon={AlertTriangle}
                tone={stats.low > 0 ? "warning" : undefined}
              />
              <Kpi
                label={t("kpi.thisSession")}
                value={session.data ? (report.isPending ? "…" : sessionReceived.toLocaleString()) : "—"}
                sub={session.data ? t("kpi.unitsSince", { time: timeAgo(session.data.openedAt) }) : t("kpi.noSession")}
                icon={ClipboardList}
              />
            </>
          ) : (
            Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loading")} />)
          )}
        </div>
      )}

      {health && (
        <Panel title={t("health.title")}>
          <div
            role="img"
            aria-label={t("health.summary", { inStock: String(health[0].value), low: String(health[1].value), out: String(health[2].value) })}
            className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
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
          title={t("attention.title")}
          action={
            <Link href="/stock" className="flex items-center gap-1 text-xs text-primary hover:underline">
              {t("actions.allStock")} <ArrowRight className="size-3" />
            </Link>
          }
        >
          <PanelState pending={items.isPending} error={items.error} empty={attention.length === 0} emptyText={t("attention.empty")} />
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
                    {item.quantityOnHand === 0 ? t("attention.out") : t("attention.left", { count: item.quantityOnHand ?? 0 })}
                  </StatusPill>
                  <Button type="button" variant="outline" size="sm" className="h-9 px-3" onClick={() => setReceiving(item)}>
                    {t("actions.receive")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={t("session.title")}
          action={
            <Link href="/restock-sessions" className="flex items-center gap-1 text-xs text-primary hover:underline">
              {t("actions.allSessions")} <ArrowRight className="size-3" />
            </Link>
          }
        >
          <PanelState
            pending={session.isPending || (!!session.data && report.isPending)}
            error={session.error ?? report.error}
            empty={!session.data || topReceived.length === 0}
            emptyText={session.data ? t("session.emptyNothingReceived") : t("session.emptyNoSession")}
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
                    {line.sold > 0
                      ? t("session.receivedAndSold", { received: String(line.restocked), sold: String(line.sold) })
                      : t("session.received", { received: String(line.restocked) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t("alerts.title")}>
        <PanelState pending={alerts.isPending} error={alerts.error} empty={(alerts.data ?? []).length === 0} emptyText={t("alerts.empty")} />
        {(alerts.data ?? []).length > 0 && (
          <ul className="divide-y">
            {(alerts.data ?? []).slice(0, 6).map((alert, index) => {
              const item = itemBySku.get(alert.sku);
              return (
                <li key={`${alert.sku}-${alert.timestamp}-${index}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item?.name ?? alert.sku}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("alerts.dropped", { quantity: String(alert.quantityOnHand), threshold: String(alert.threshold) })}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(alert.timestamp)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <QuickReceiveDialog open={receiving !== null} onOpenChange={(open) => !open && setReceiving(null)} items={receiving ? [receiving] : []} />
    </div>
  );
}
