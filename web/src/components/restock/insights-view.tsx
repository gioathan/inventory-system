"use client";

import { useMemo, useState } from "react";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { useCategories } from "@/hooks/use-items";
import { useRestockSessions, useSessionReports } from "@/hooks/use-restock-sessions";
import { formatMoney } from "@/lib/format";
import { aggregateInsights, numberSessions, sessionLabel, type Insights } from "@/lib/restock";
import { cn } from "@/lib/utils";

const SCOPES = [
  { id: 1, label: "Latest" },
  { id: 3, label: "Last 3" },
  { id: 5, label: "Last 5" },
  { id: 10, label: "Last 10" },
  { id: 0, label: "All" },
] as const;
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

export function InsightsView() {
  const sessions = useRestockSessions();
  const categories = useCategories();
  const [scope, setScope] = useState<number>(5);
  const [measure, setMeasure] = useState<"units" | "revenue">("units");

  const numbered = useMemo(() => numberSessions(sessions.data ?? []), [sessions.data]);
  const inScope = useMemo(() => (scope === 0 ? numbered : numbered.slice(0, scope)), [numbered, scope]);
  const results = useSessionReports(inScope.map((s) => s.id));
  const categoryName = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data]);

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
      (id) => categoryName.get(id),
    );
    // dataKey stands in for `results`, whose array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, inScope, dataKey, categoryName]);
  if (insights && insights !== last) setLast(insights);
  const shown = insights ?? last;

  if (sessions.isPending) return <div className="h-48 animate-pulse rounded-2xl border bg-muted/40" aria-label="Loading sessions" />;
  if (numbered.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        No sessions yet. Insights appear once sessions have sales in them.
      </p>
    );
  }

  const money = measure === "revenue";
  const valueOf = (r: { sold: number; revenue: number }) => (money ? r.revenue : r.sold);
  const fmt = (v: number) => (money ? formatMoney(v) : Math.round(v).toLocaleString());
  const other = (r: { sold: number; revenue: number }) => (money ? `${r.sold.toLocaleString()} sold` : formatMoney(r.revenue));
  const rank = <R extends { key: string; label: string; sold: number; revenue: number }>(rows: R[]) =>
    [...rows]
      .sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label))
      .slice(0, TOP)
      .map((r) => ({ key: r.key, label: r.label, value: valueOf(r), detail: other(r) }));

  const totals = shown
    ? shown.trend.reduce((t, p) => ({ sold: t.sold + p.sold, revenue: t.revenue + p.revenue }), { sold: 0, revenue: 0 })
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Sessions to include" options={SCOPES} value={scope} onChange={setScope} />
        <Segmented
          label="Measure"
          options={[
            { id: "units", label: "Units sold" },
            { id: "revenue", label: "Revenue" },
          ] as const}
          value={measure}
          onChange={setMeasure}
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {inScope.length === 1 ? `Session ${sessionLabel(inScope[0])}` : `${inScope.length} sessions, #${inScope.at(-1)?.number} to #${inScope[0]?.number}`}
        {shown?.estimated && " · ≈ revenue includes sales from before prices were recorded, valued at today's price"}
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load a session report: {error.message}
        </p>
      ) : !shown ? (
        <div className="h-64 animate-pulse rounded-2xl border bg-muted/40" aria-label="Loading insights" />
      ) : (
        <div className={cn("flex flex-col gap-5 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
          <dl className="grid grid-cols-3 gap-3">
            {[
              { label: "Units sold", value: totals!.sold.toLocaleString() },
              { label: "Revenue", value: `${shown.estimated ? "≈ " : ""}${formatMoney(totals!.revenue)}` },
              { label: "Items sold", value: shown.items.length.toLocaleString() },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border bg-card p-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</dt>
                <dd className="mt-1 text-2xl font-semibold">{s.value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-label="Top items" className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">Top items by {money ? "revenue" : "units sold"}</h2>
              <BarList
                title="Item"
                rows={rank(shown.items)}
                format={fmt}
                valueHeader={money ? "Revenue" : "Units sold"}
                emptyText="Nothing sold in these sessions."
              />
            </section>
            <section aria-label="Top categories" className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">Top categories by {money ? "revenue" : "units sold"}</h2>
              <BarList
                title="Category"
                rows={rank(shown.categories)}
                format={fmt}
                valueHeader={money ? "Revenue" : "Units sold"}
                emptyText="Nothing sold in these sessions."
              />
              <p className="text-xs text-muted-foreground">Uses each item&apos;s current category.</p>
            </section>
          </div>

          {shown.trend.length > 1 && (
            <section aria-label="Trend across sessions" className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">{money ? "Revenue" : "Units sold"} per session</h2>
              <ColumnChart
                title="Sessions"
                points={shown.trend.map((p) => ({
                  key: p.session.id,
                  label: `#${p.session.number}`,
                  name: sessionLabel(p.session),
                  value: valueOf(p),
                  detail: other(p),
                }))}
                format={fmt}
                valueHeader={money ? "Revenue" : "Units sold"}
              />
              <p className="text-xs text-muted-foreground">Totals per session, not per day — longer sessions naturally sell more. Compare per day on the Compare tab.</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
