"use client";

import { ArrowDown, ArrowUp, Download, Loader2, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCategoryTree } from "@/hooks/use-items";
import { useDailySales, useSessionReport } from "@/hooks/use-restock-sessions";
import { downloadCsv, toCsv } from "@/lib/csv";
import { isoDateToDate } from "@/lib/dated-discounts";
import { formatMoney, formatPercent } from "@/lib/format";
import { attentionOf, percentChange, sessionDays, totalsOf, type NumberedSession } from "@/lib/restock";
import { useTimeFormat } from "@/lib/time";
import type { SessionReportLine } from "@/lib/types";
import { SITE_CONFIG } from "@/lib/site-config";
import { cn } from "@/lib/utils";

type Measure = "units" | "revenue";
type SortKey = "name" | "start" | "received" | "sold" | "end" | "revenue";

const TOP = 8;
const ATTENTION_SHOWN = 6;

// "13.8", "4", "0.6": a per-day rate, short enough to read at a glance.
const rate = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 });

// One session, told as a story rather than a table: what happened in a sentence, the handful of
// numbers that matter (each saying what it means and how it compares with the session before),
// when it happened day by day, what sold best, what needs acting on — and only then every item.
export function SessionReport({ session, previous, onClose }: { session: NumberedSession; previous: NumberedSession | null; onClose?: () => void }) {
  const t = useTranslations("restock");
  const format = useFormatter();
  const { formatDateTime } = useTimeFormat();
  const tree = useCategoryTree();
  const report = useSessionReport(session.id);
  const before = useSessionReport(previous?.id ?? null);
  const daily = useDailySales(session.openedAt, session.closedAt);

  const [measureChoice, setMeasure] = useState<Measure>("units");
  // Revenue can be switched off for the whole site (lib/site-config.ts); then only units show.
  const showRevenue = SITE_CONFIG.showRevenue;
  const measure: Measure = showRevenue ? measureChoice : "units";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "sold", descending: true });

  const n = String(session.number);
  const open = session.closedAt === null;
  const lines = useMemo(() => report.data ?? [], [report.data]);
  const totals = useMemo(() => totalsOf(lines), [lines]);
  const attention = useMemo(() => attentionOf(lines), [lines]);
  const days = sessionDays(session);
  const length = days <= 1 ? t("compare.dayOrLess") : t("report.length", { days: Math.round(days) });
  const money = measure === "revenue";
  const approx = totals.estimated ? "≈ " : "";

  // The session before, per day — sessions differ in length, so totals alone would mislead.
  const earlier = previous && before.data ? { totals: totalsOf(before.data), days: sessionDays(previous) } : null;
  const soldChange = earlier ? percentChange(earlier.totals.sold / earlier.days, totals.sold / days) : null;
  const revenueChange = earlier ? percentChange(earlier.totals.revenue / earlier.days, totals.revenue / days) : null;

  const nameOf = (line: SessionReportLine) => line.name ?? t("report.removedItem");
  const valueOf = (line: SessionReportLine) => (money ? (line.revenue ?? 0) : line.sold);
  const fmt = (value: number) => (money ? formatMoney(value) : value.toLocaleString());
  const measureName = money ? t("report.revenue") : t("report.unitsSold");

  const topItems = [...lines]
    .filter((l) => valueOf(l) > 0)
    .sort((a, b) => valueOf(b) - valueOf(a))
    .slice(0, TOP)
    .map((l) => ({ key: l.sku, label: nameOf(l), value: valueOf(l), detail: money ? t("report.soldDetail", { count: l.sold }) : !showRevenue || l.revenue === null ? undefined : formatMoney(l.revenue) }));

  // By top-level category, like Insights: "Earrings" sales count as "Jewelry".
  const byCategory = new Map<string, { label: string; value: number }>();
  for (const line of lines) {
    const top = line.categoryId ? tree.topLevel(line.categoryId) : undefined;
    const key = top?.id ?? (line.categoryId ? "unknown" : "none");
    const label = top?.name ?? (line.categoryId ? t("categories.unknown") : t("categories.none"));
    const entry = byCategory.get(key) ?? { label, value: 0 };
    entry.value += valueOf(line);
    byCategory.set(key, entry);
  }
  const topCategories = [...byCategory.entries()]
    .filter(([, c]) => c.value > 0)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, TOP)
    .map(([key, c]) => ({ key, label: c.label, value: c.value }));

  const dayPoints = (daily.data ?? []).map((d) => {
    const date = isoDateToDate(d.date);
    return {
      key: d.date,
      label: format.dateTime(date, { day: "numeric", month: "short", timeZone: "UTC" }),
      name: format.dateTime(date, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
      value: money ? d.revenue : d.unitsSold,
      detail: money ? t("report.soldDetail", { count: d.unitsSold }) : showRevenue ? formatMoney(d.revenue) : undefined,
    };
  });
  const best = dayPoints.length > 1 ? dayPoints.reduce((a, b) => (b.value > a.value ? b : a)) : null;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const value = (l: SessionReportLine): number | string =>
      sort.key === "name" ? (l.name ?? "").toLowerCase()
      : sort.key === "start" ? l.openingQuantity
      : sort.key === "received" ? l.restocked
      : sort.key === "sold" ? l.sold
      : sort.key === "end" ? l.closingQuantity
      : (l.revenue ?? 0);
    return lines
      .filter((l) => !needle || (l.name ?? "").toLowerCase().includes(needle) || l.sku.toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = value(a), y = value(b);
        const order = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
        return (sort.descending ? -order : order) || (a.name ?? a.sku).localeCompare(b.name ?? b.sku);
      });
  }, [lines, search, sort]);

  function exportCsv() {
    downloadCsv(
      `session-${n}.csv`,
      toCsv(
        ["SKU", "Item", "Start", "Received", "Sold", "End", ...(showRevenue ? ["Revenue"] : [])],
        visible.map((l) => [l.sku, l.name ?? "", l.openingQuantity, l.restocked, l.sold, l.closingQuantity, ...(showRevenue ? [l.revenue] : [])]),
      ),
    );
  }

  const column = (key: SortKey, label: string, className: string) => (
    <th className={cn("py-2 font-medium", className)} aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        onClick={() => setSort((current) => ({ key, descending: current.key === key ? !current.descending : key !== "name" }))}
        className="inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-foreground"
      >
        {label}
        {sort.key === key && (sort.descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );

  return (
    <section aria-label={t("report.label", { number: n })} className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("sessions.name", { number: n })}</h2>
          <p className="text-sm text-muted-foreground">
            {t("report.range", {
              from: formatDateTime(session.openedAt),
              to: session.closedAt ? formatDateTime(session.closedAt) : t("report.nowStillOpen"),
            })}
          </p>
          {session.note && <p className="text-sm">{session.note}</p>}
        </div>
        {onClose && (
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            {t("actions.closeSession")}
          </Button>
        )}
      </div>

      {report.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("report.loading")}
        </div>
      ) : report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("report.loadError", { message: report.error.message })}
        </p>
      ) : lines.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("report.empty")}</p>
      ) : (
        <>
          {/* What happened, in words: the numbers below are the detail behind these sentences. */}
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm leading-relaxed">
            {totals.sold > 0
              ? t(open ? (showRevenue ? "report.summary.soldSoFar" : "report.summary.soldSoFarNoMoney") : showRevenue ? "report.summary.sold" : "report.summary.soldNoMoney", {
                  sold: totals.sold,
                  items: totals.itemsSold,
                  revenue: `${approx}${formatMoney(totals.revenue)}`,
                  length,
                  perDay: rate(totals.sold / days),
                })
              : t("report.summary.nothingSold", { length })}{" "}
            {soldChange !== null && previous && soldChange !== 0 && (
              <>
                {t("report.summary.versus", { direction: soldChange > 0 ? "up" : "down", percent: formatPercent(Math.abs(soldChange)), number: String(previous.number) })}{" "}
              </>
            )}
            {totals.received > 0 && <>{t("report.summary.received", { received: totals.received })} </>}
            {attention.soldOut.length > 0 && <>{t("report.summary.soldOut", { count: attention.soldOut.length })} </>}
            {attention.notSelling.length > 0 && <>{t("report.summary.notSelling", { count: attention.notSelling.length })}</>}
          </p>

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {showRevenue && (
              <Stat label={t("report.revenue")} value={`${approx}${formatMoney(totals.revenue)}`} note={t("report.notes.revenue", { perDay: formatMoney(totals.revenue / days) })} change={revenueChange} versus={previous?.number} />
            )}
            <Stat label={t("report.unitsSold")} value={totals.sold.toLocaleString()} note={t("report.notes.sold", { items: totals.itemsSold })} />
            <Stat label={t("report.soldPerDay")} value={rate(totals.sold / days)} note={t("report.notes.perDay", { length })} change={soldChange} versus={previous?.number} />
            <Stat label={t("report.unitsReceived")} value={totals.received.toLocaleString()} note={t("report.notes.received")} />
            <Stat
              label={t("report.sellThrough")}
              value={totals.sellThrough === null ? "—" : formatPercent(totals.sellThrough)}
              note={t("report.notes.sellThrough")}
            />
            <Stat
              label={t("report.soldOutCount")}
              value={attention.soldOut.length.toLocaleString()}
              note={t("report.notes.soldOut")}
              tone={attention.soldOut.length > 0 ? "warning" : undefined}
            />
          </dl>

          {showRevenue && (
          <div role="group" aria-label={t("report.measureLabel")} className="flex gap-2">
            {(["units", "revenue"] as const).map((m) => (
              <Button key={m} type="button" variant={measure === m ? "default" : "outline"} className="h-9" aria-pressed={measure === m} onClick={() => setMeasure(m)}>
                {m === "units" ? t("report.unitsSold") : t("report.revenue")}
              </Button>
            ))}
          </div>
          )}

          {dayPoints.length > 1 && (
            <section aria-label={t("report.perDayLabel")} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">{money ? t("report.revenuePerDay") : t("report.unitsPerDay")}</h3>
              <ColumnChart title={t("report.perDayLabel")} points={dayPoints} format={fmt} valueHeader={measureName} labelHeader={t("report.day")} />
              {best && best.value > 0 && <p className="text-xs text-muted-foreground">{t("report.bestDay", { day: best.name, value: fmt(best.value) })}</p>}
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <section aria-label={t("report.bestSellers")} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">{t("report.bestSellers")}</h3>
              <BarList title={t("report.columns.item")} rows={topItems} format={fmt} valueHeader={measureName} emptyText={t("report.noSales")} />
            </section>
            <section aria-label={t("report.topCategories")} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">{t("report.topCategories")}</h3>
              <BarList title={t("insights.category")} rows={topCategories} format={fmt} valueHeader={measureName} emptyText={t("report.noSales")} />
            </section>
          </div>

          {(attention.soldOut.length > 0 || attention.notSelling.length > 0) && (
            <div className="grid gap-4 xl:grid-cols-2">
              {attention.soldOut.length > 0 && (
                <AttentionList
                  title={t("report.attention.soldOutTitle", { count: attention.soldOut.length })}
                  explanation={t("report.attention.soldOutExplanation")}
                  lines={attention.soldOut}
                  nameOf={nameOf}
                  detail={(l) => t("report.soldDetail", { count: l.sold })}
                  more={(count) => t("report.attention.more", { count })}
                />
              )}
              {attention.notSelling.length > 0 && (
                <AttentionList
                  title={t("report.attention.notSellingTitle", { count: attention.notSelling.length })}
                  explanation={t("report.attention.notSellingExplanation")}
                  lines={attention.notSelling}
                  nameOf={nameOf}
                  detail={(l) => t("report.attention.receivedInStock", { received: l.restocked, stock: l.closingQuantity })}
                  more={(count) => t("report.attention.more", { count })}
                />
              )}
            </div>
          )}

          <section aria-label={t("report.itemsLabel", { number: n })} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("report.allItems", { count: lines.length })}</h3>
              <div className="flex flex-1 items-center justify-end gap-2">
                <div className="relative w-full max-w-64">
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("report.searchItems")} placeholder={t("report.searchItems")} autoComplete="off" className="h-9 pl-9" />
                </div>
                <Button type="button" variant="outline" className="h-9 gap-2" onClick={exportCsv}>
                  <Download className="size-4" />
                  {t("report.export")}
                </Button>
              </div>
            </div>
            {/* Scrolls sideways on phones, so it must be reachable by keyboard (tabIndex + a name). */}
            <div tabIndex={0} role="region" aria-label={t("report.itemsLabel", { number: n })} className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    {column("name", t("report.columns.item"), "pr-3")}
                    {column("start", t("report.columns.start"), "px-3 text-right")}
                    {column("received", t("report.columns.received"), "px-3 text-right")}
                    {column("sold", t("report.columns.sold"), "px-3 text-right")}
                    {column("end", t("report.columns.end"), "px-3 text-right")}
                    {showRevenue && column("revenue", t("report.columns.revenue"), "pl-3 text-right")}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((line) => (
                    <tr key={line.sku}>
                      <td className="max-w-56 py-2.5 pr-3">
                        <div className="truncate font-medium">{nameOf(line)}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{line.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{line.openingQuantity}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">+{line.restocked}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">−{line.sold}</td>
                      <td className={cn("px-3 py-2.5 text-right font-medium tabular-nums", line.closingQuantity === 0 && "text-destructive")}>{line.closingQuantity}</td>
                      {showRevenue && (
                        <td className="py-2.5 pl-3 text-right tabular-nums">
                        {line.revenue === null ? "—" : `${line.revenueEstimated ? "≈ " : ""}${formatMoney(line.revenue)}`}
                      </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t("compare.noMatches")}</p>}
            </div>
            <p className="text-xs text-muted-foreground">{t("report.columnsNote")}</p>
          </section>
        </>
      )}

      {showRevenue && <p className="text-xs text-muted-foreground">{totals.estimated ? t("report.revenueNoteEstimated") : t("report.revenueNote")}</p>}
    </section>
  );
}

// One number with what it means underneath, and — when there's a session before to measure
// against — how it moved. The change is always per day, since sessions differ in length.
function Stat({
  label,
  value,
  note,
  change,
  versus,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  change?: number | null;
  versus?: number;
  tone?: "warning";
}) {
  const t = useTranslations("restock");
  return (
    <div className="flex flex-col gap-1 rounded-xl border px-3 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("text-xl font-semibold tabular-nums", tone === "warning" && "text-warning")}>{value}</dd>
      {change !== null && change !== undefined && versus !== undefined && (
        <dd className={cn("flex items-center gap-1 text-xs font-medium", change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground")}>
          {change > 0 ? <ArrowUp className="size-3" /> : change < 0 ? <ArrowDown className="size-3" /> : null}
          {change === 0
            ? t("report.change.same", { number: String(versus) })
            : t("report.change.versus", { percent: formatPercent(Math.abs(change)), direction: change > 0 ? "up" : "down", number: String(versus) })}
        </dd>
      )}
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

function AttentionList({
  title,
  explanation,
  lines,
  nameOf,
  detail,
  more,
}: {
  title: string;
  explanation: string;
  lines: SessionReportLine[];
  nameOf: (line: SessionReportLine) => string;
  detail: (line: SessionReportLine) => string;
  more: (count: number) => string;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{explanation}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.slice(0, ATTENTION_SHOWN).map((line) => (
          <li key={line.sku} className="flex items-baseline justify-between gap-3">
            <span className="truncate">{nameOf(line)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{detail(line)}</span>
          </li>
        ))}
      </ul>
      {lines.length > ATTENTION_SHOWN && <p className="text-xs text-muted-foreground">{more(lines.length - ATTENTION_SHOWN)}</p>}
    </section>
  );
}
