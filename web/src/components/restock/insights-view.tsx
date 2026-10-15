"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { useCategoryTree, useItems } from "@/hooks/use-items";
import { useRestockSessions, useSessionReports } from "@/hooks/use-restock-sessions";
import { formatMoney, formatPercent } from "@/lib/format";
import { aggregateInsights, numberSessions, sessionDays, useSessionLabel, type Insights } from "@/lib/restock";
import { SITE_CONFIG } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// 0 means every session. Labels are resolved in the component ("Latest", "Last 3", "All").
// How many of the newest sessions to include: a count, 0 for all of them, or LAST_MONTH for
// every session that was running at some point in the last 30 days.
const LAST_MONTH = -30;
const SCOPES = [1, 3, 5, 10, LAST_MONTH, 0] as const;
const TOP = 10;

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    // One row that scrolls sideways on narrow phones rather than wrapping a lone button.
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-9 shrink-0 rounded-md px-3 text-sm font-medium",
            value === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const UNSOLD_SHOWN = 10;

export function InsightsView() {
  const sessions = useRestockSessions();
  const tree = useCategoryTree();
  const catalog = useItems();
  const [scope, setScope] = useState<number>(5);
  const [measureChoice, setMeasure] = useState<"units" | "revenue">("units");
  // Revenue can be switched off for the whole site (lib/site-config.ts); then only units show.
  const measure = SITE_CONFIG.showRevenue ? measureChoice : "units";
  const t = useTranslations("restock");
  const sessionLabel = useSessionLabel();
  const noCategory = t("categories.none");
  const unknownCategory = t("categories.unknown");

  const numbered = useMemo(() => numberSessions(sessions.data ?? []), [sessions.data]);
  // Fixed when the screen opens, so the list of sessions doesn't shift between renders.
  const [monthAgo] = useState(() => Date.now() - 30 * 86_400_000);
  const inScope = useMemo(() => {
    if (scope === 0) return numbered;
    // A session counts if it hadn't already ended a month ago; one still open always counts.
    if (scope === LAST_MONTH) return numbered.filter((s) => s.closedAt === null || new Date(s.closedAt).getTime() >= monthAgo);
    return numbered.slice(0, scope);
  }, [numbered, scope, monthAgo]);
  const results = useSessionReports(inScope.map((s) => s.id));

  const pending = results.some((r) => r.isPending);
  const error = results.find((r) => r.error)?.error;
  const complete = !pending && !error && inScope.length > 0;
  const dataKey = results.map((r) => r.dataUpdatedAt).join(",");

  // Hold the previous render (dimmed) while a new scope loads, instead of flashing a skeleton.
  // React's "store information from previous renders" pattern: a conditional setState during render.
  const [last, setLast] = useState<Insights | null>(null);
  const insights = useMemo(() => {
    if (!complete) return null;
    return aggregateInsights(
      inScope.map((session, i) => ({ session, lines: results[i].data ?? [] })),
      (id) => tree.get(id)?.name,
      { none: noCategory, unknown: unknownCategory },
      (id) => tree.topLevel(id)?.id ?? id,
    );
    // dataKey stands in for `results`, whose array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, inScope, dataKey, tree, noCategory, unknownCategory]);
  if (insights && insights !== last) setLast(insights);
  const shown = insights ?? last;

  if (sessions.isPending) return <div className="h-48 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loadingSessions")} />;
  if (numbered.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        {t("insights.empty")}
      </p>
    );
  }

  const scopeOptions = SCOPES.map((id) => ({
    id: id as number,
    label:
      id === 1 ? t("insights.scopes.latest")
      : id === 0 ? t("insights.scopes.all")
      : id === LAST_MONTH ? t("insights.scopes.lastMonth")
      : t("insights.scopes.last", { count: String(id) }),
  }));
  const money = measure === "revenue";
  const measureName = money ? t("insights.revenue") : t("insights.unitsSold");
  const valueOf = (r: { sold: number; revenue: number }) => (money ? r.revenue : r.sold);
  const fmt = (v: number) => (money ? formatMoney(v) : Math.round(v).toLocaleString());
  const other = (r: { sold: number; revenue: number }) =>
    money ? t("insights.soldDetail", { count: r.sold.toLocaleString() }) : SITE_CONFIG.showRevenue ? formatMoney(r.revenue) : undefined;
  const rank = <R extends { key: string; label: string; sold: number; revenue: number }>(rows: R[]) =>
    [...rows]
      .sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label))
      .slice(0, TOP)
      .map((r) => ({ key: r.key, label: r.label, value: valueOf(r), detail: other(r) }));

  const categoryTotal = shown ? shown.categories.reduce((sum, r) => sum + valueOf(r), 0) : 0;
  // Stock that is sitting: in stock now, and not one sold in the sessions being looked at.
  // Biggest value first — that is the money tied up.
  const soldSkus = new Set((shown?.items ?? []).map((r) => r.key));
  const unsold = shown
    ? (catalog.data ?? [])
        .filter((i) => (i.quantityOnHand ?? 0) > 0 && !soldSkus.has(i.sku))
        .sort((a, b) => (b.quantityOnHand ?? 0) * b.effectivePrice - (a.quantityOnHand ?? 0) * a.effectivePrice)
    : [];
  const unsoldValue = unsold.reduce((sum, i) => sum + (i.quantityOnHand ?? 0) * i.effectivePrice, 0);

  const totals = shown
    ? shown.trend.reduce((acc, p) => ({ sold: acc.sold + p.sold, revenue: acc.revenue + p.revenue }), { sold: 0, revenue: 0 })
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label={t("insights.scopeLabel")} options={scopeOptions} value={scope} onChange={setScope} />
        {SITE_CONFIG.showRevenue && (
        <Segmented
          label={t("insights.measureLabel")}
          options={[
            { id: "units", label: t("insights.unitsSold") },
            { id: "revenue", label: t("insights.revenue") },
          ] as const}
          value={measure}
          onChange={setMeasure}
        />
        )}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {scope === LAST_MONTH && <>{t("insights.lastMonthNote")} </>}
        {inScope.length === 0
          ? null
          : inScope.length === 1
          ? t("insights.single", { label: sessionLabel(inScope[0]) })
          : t("insights.range", {
              count: String(inScope.length),
              from: String(inScope.at(-1)?.number ?? ""),
              to: String(inScope[0]?.number ?? ""),
            })}
        {SITE_CONFIG.showRevenue && shown?.estimated && <> · {t("insights.estimatedNote")}</>}
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("insights.loadError", { message: error.message })}
        </p>
      ) : inScope.length === 0 ? (
        // Only "Last month" can come up empty: every other choice includes at least one session.
        <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{t("insights.lastMonthEmpty")}</p>
      ) : !shown ? (
        <div className="h-64 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("insights.loading")} />
      ) : (
        <div className={cn("flex flex-col gap-5 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
          <dl className={cn("grid gap-3", SITE_CONFIG.showRevenue ? "grid-cols-3" : "grid-cols-2")}>
            {[
              { id: "unitsSold", label: t("insights.unitsSold"), value: totals!.sold.toLocaleString() },
              ...(SITE_CONFIG.showRevenue
                ? [{ id: "revenue", label: t("insights.revenue"), value: `${shown.estimated ? "≈ " : ""}${formatMoney(totals!.revenue)}` }]
                : []),
              { id: "itemsSold", label: t("insights.itemsSold"), value: shown.items.length.toLocaleString() },
            ].map((s) => (
              <div key={s.id} className="rounded-2xl border bg-card p-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</dt>
                <dd className="mt-1 text-2xl font-semibold">{s.value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-label={t("insights.topItemsLabel")} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">{money ? t("insights.topItemsByRevenue") : t("insights.topItemsByUnits")}</h2>
              <BarList
                title={t("insights.item")}
                rows={rank(shown.items)}
                format={fmt}
                valueHeader={measureName}
                emptyText={t("insights.noSales")}
              />
            </section>
            <section aria-label={t("insights.topCategoriesLabel")} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">{money ? t("insights.topCategoriesByRevenue") : t("insights.topCategoriesByUnits")}</h2>
              <BarList
                title={t("insights.category")}
                rows={rank(shown.categories).map((r) => ({ ...r, label: categoryTotal > 0 ? `${r.label} · ${formatPercent(r.value / categoryTotal)}` : r.label }))}
                format={fmt}
                valueHeader={measureName}
                emptyText={t("insights.noSales")}
              />
              <p className="text-xs text-muted-foreground">{t("insights.currentCategory")}</p>
            </section>
          </div>

          {shown.trend.length > 1 && (
            <section aria-label={t("insights.trendLabel")} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">{money ? t("insights.revenuePerDayBySession") : t("insights.unitsPerDayBySession")}</h2>
              <ColumnChart
                title={t("insights.sessionsLabel")}
                points={shown.trend.map((p) => ({
                  key: p.session.id,
                  label: `#${p.session.number}`,
                  name: sessionLabel(p.session),
                  // Per day, so a session that simply ran longer doesn't tower over the others.
                  value: valueOf(p) / sessionDays(p.session),
                  detail: other(p),
                }))}
                format={(v) => (money ? formatMoney(v) : v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 }))}
                valueHeader={measureName}
              />
              <p className="text-xs text-muted-foreground">{t("insights.trendNote")}</p>
            </section>
          )}

          {unsold.length > 0 && (
            <section aria-label={t("insights.unsold.title", { count: unsold.length })} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold">{t("insights.unsold.title", { count: unsold.length })}</h2>
                <p className="text-xs text-muted-foreground">{t("insights.unsold.explanation", { value: formatMoney(unsoldValue) })}</p>
              </div>
              <ul className="divide-y text-sm">
                {unsold.slice(0, UNSOLD_SHOWN).map((item) => (
                  <li key={item.sku} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {t("insights.unsold.detail", { stock: item.quantityOnHand ?? 0, value: formatMoney((item.quantityOnHand ?? 0) * item.effectivePrice) })}
                    </span>
                  </li>
                ))}
              </ul>
              {unsold.length > UNSOLD_SHOWN && <p className="text-xs text-muted-foreground">{t("insights.unsold.more", { count: unsold.length - UNSOLD_SHOWN })}</p>}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
