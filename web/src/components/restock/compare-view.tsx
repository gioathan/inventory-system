"use client";

import { ArrowDown, ArrowUp, Loader2, Minus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { FilterChips } from "@/components/filter-chips";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { useCategoryTree } from "@/hooks/use-items";
import { useRestockSessions, useSessionReport } from "@/hooks/use-restock-sessions";
import { formatMoney } from "@/lib/format";
import {
  compareCategories,
  compareItems,
  numberSessions,
  percentChange,
  sessionDays,
  totalsOf,
  useSessionLabel,
  type ComparedRow,
} from "@/lib/restock";
import { SITE_CONFIG } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// Each id doubles as its label key under "compare.filters" in the restock messages.
const ROW_FILTERS = ["all", "up", "down", "new", "stopped", "soldout"] as const;
type RowFilter = (typeof ROW_FILTERS)[number];

const MATCHES: Record<RowFilter, (r: ComparedRow) => boolean> = {
  all: () => true,
  up: (r) => r.change > 0,
  down: (r) => r.change < 0,
  new: (r) => r.isNew,
  stopped: (r) => r.stopped,
  soldout: (r) => r.soldOutInB,
};

// Green/red only where up is good (sales, revenue); a change in units received is just a change.
function Change({ value, pct, money = false, neutral = false }: { value: number; pct: number | null; money?: boolean; neutral?: boolean }) {
  const t = useTranslations("restock");
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  const tone = neutral || value === 0 ? "text-muted-foreground" : value > 0 ? "text-success" : "text-destructive";
  const shown = money ? formatMoney(Math.abs(value)) : Math.abs(Math.round(value * 10) / 10).toLocaleString();
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", tone)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{value > 0 ? t("compare.change.up") : value < 0 ? t("compare.change.down") : t("compare.change.none")}</span>
      {shown}
      {pct !== null && <span className="text-xs">({Math.round(pct * 100)}%)</span>}
    </span>
  );
}

// How many items each of the "selling faster / slower" lists names.
const MOVERS_SHOWN = 5;

export function CompareView() {
  const sessions = useRestockSessions();
  const tree = useCategoryTree();
  const numbered = useMemo(() => numberSessions(sessions.data ?? []), [sessions.data]);
  const t = useTranslations("restock");
  const sessionLabel = useSessionLabel();
  const noCategory = t("categories.none");
  const unknownCategory = t("categories.unknown");
  const lengthOf = (days: number) => (days <= 1 ? t("compare.dayOrLess") : t("compare.days", { days: String(Math.round(days * 10) / 10) }));

  // Default: the latest session against the one before it.
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const b = numbered.find((s) => s.id === bId) ?? numbered[0] ?? null;
  const a = numbered.find((s) => s.id === aId) ?? numbered.find((s) => s.id !== b?.id) ?? null;

  const reportA = useSessionReport(a?.id ?? null);
  const reportB = useSessionReport(b?.id ?? null);

  // Per day by default: two sessions are rarely the same length, and totals would then mostly
  // measure which one ran longer.
  const [perDay, setPerDay] = useState(true);
  const [by, setBy] = useState<"item" | "category">("item");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [search, setSearch] = useState("");

  const daysA = a ? sessionDays(a) : 1;
  const daysB = b ? sessionDays(b) : 1;
  const scaleA = perDay ? 1 / daysA : 1;
  const scaleB = perDay ? 1 / daysB : 1;

  const rows = useMemo(() => {
    if (!reportA.data || !reportB.data) return [];
    const compared = by === "item"
      ? compareItems(reportA.data, reportB.data)
      : compareCategories(reportA.data, reportB.data, (id) => tree.get(id)?.name, { none: noCategory, unknown: unknownCategory }, (id) => tree.topLevel(id)?.id ?? id);
    // "Selling more / less", their counts and the sort order must follow the numbers on screen:
    // with "Per day" on, an item that sold 4 in a one-day session and 4 in a two-day one is
    // selling less, even though the totals are equal.
    return compared.map((r) => ({ ...r, change: r.soldB * scaleB - r.soldA * scaleA, pct: percentChange(r.soldA * scaleA, r.soldB * scaleB) }));
  }, [reportA.data, reportB.data, by, tree, noCategory, unknownCategory, scaleA, scaleB]);

  const counts = useMemo(
    () => Object.fromEntries(ROW_FILTERS.map((id) => [id, rows.filter(MATCHES[id]).length])) as Record<RowFilter, number>,
    [rows],
  );
  const filterOptions = ROW_FILTERS.map((id) => ({ id, label: t(`compare.filters.${id}`) }));
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter(MATCHES[filter])
      .filter((r) => !term || r.label.toLowerCase().includes(term))
      .sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || y.soldB - x.soldB || x.label.localeCompare(y.label));
  }, [rows, filter, search]);

  if (sessions.isPending) return <div className="h-48 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loadingSessions")} />;
  if (numbered.length < 2) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        {t("compare.needTwo")}
      </p>
    );
  }

  const tA = reportA.data ? totalsOf(reportA.data) : null;
  const tB = reportB.data ? totalsOf(reportB.data) : null;
  const loading = reportA.isPending || reportB.isPending;
  const error = reportA.error ?? reportB.error;
  const numA = String(a?.number ?? "");
  const numB = String(b?.number ?? "");

  // The comparison in a sentence, and the items behind it: always per day, whatever the
  // "Per day" switch says about the totals below.
  const rate = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 });
  const paceA = tA ? tA.sold / daysA : 0;
  const paceB = tB ? tB.sold / daysB : 0;
  const paceChange = percentChange(paceA, paceB);
  const movers = (reportA.data && reportB.data ? compareItems(reportA.data, reportB.data) : [])
    .map((r) => ({ key: r.key, label: r.label, before: r.soldA / daysA, after: r.soldB / daysB }))
    .map((r) => ({ ...r, difference: r.after - r.before }))
    .filter((r) => r.difference !== 0);
  const faster = movers.filter((r) => r.difference > 0).sort((x, y) => y.difference - x.difference).slice(0, MOVERS_SHOWN);
  const slower = movers.filter((r) => r.difference < 0).sort((x, y) => x.difference - y.difference).slice(0, MOVERS_SHOWN);

  const kpis =
    tA && tB
      ? [
          { id: "unitsSold", label: t("compare.kpi.unitsSold"), a: tA.sold * scaleA, b: tB.sold * scaleB, money: false },
          // Left out when the site hides revenue (lib/site-config.ts).
          ...(SITE_CONFIG.showRevenue
            ? [{ id: "revenue", label: t("compare.kpi.revenue"), a: tA.revenue * scaleA, b: tB.revenue * scaleB, money: true, estimated: tA.estimated || tB.estimated }]
            : []),
          { id: "unitsReceived", label: t("compare.kpi.unitsReceived"), a: tA.received * scaleA, b: tB.received * scaleB, money: false, neutral: true },
          { id: "itemsSold", label: t("compare.kpi.itemsSold"), a: tA.itemsSold, b: tB.itemsSold, money: false, noPerDay: true },
        ]
      : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("compare.compare")}
          <NativeSelect value={a?.id ?? ""} onChange={(e) => setAId(e.target.value)} aria-label={t("compare.firstSession")}>
            {numbered.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === b?.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("compare.with")}
          <NativeSelect value={b?.id ?? ""} onChange={(e) => setBId(e.target.value)} aria-label={t("compare.secondSession")}>
            {numbered.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === a?.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={perDay} onChange={(e) => setPerDay(e.target.checked)} className="size-4 accent-primary" />
          {t("compare.perDay")}
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t("compare.lengths", { a: lengthOf(daysA), b: lengthOf(daysB) })}</p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("compare.loadError", { message: error.message })}
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("compare.loading")}
        </div>
      ) : (
        <>
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm leading-relaxed">
            {paceChange === null
              ? t("compare.headline.noBaseline", { a: numA, b: numB, pace: rate(paceB) })
              : paceChange === 0
                ? t("compare.headline.same", { a: numA, b: numB, pace: rate(paceB) })
                : t("compare.headline.moved", {
                    a: numA,
                    b: numB,
                    percent: `${Math.round(Math.abs(paceChange) * 100)}%`,
                    direction: paceChange > 0 ? "up" : "down",
                    paceA: rate(paceA),
                    paceB: rate(paceB),
                  })}
          </p>

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => {
              const aVal = k.a;
              const bVal = k.b;
              const fmt = (v: number) => (k.money ? formatMoney(v) : (Math.round(v * 10) / 10).toLocaleString());
              return (
                <div key={k.id} className="flex flex-col gap-1.5 rounded-2xl border bg-card p-4">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {perDay && !k.noPerDay ? t("compare.kpi.perDay", { label: k.label }) : k.label}
                  </dt>
                  <dd className="flex flex-col gap-1">
                    <span className="text-2xl font-semibold tabular-nums">
                      {k.estimated ? "≈ " : ""}
                      {fmt(bVal)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{t("compare.kpi.was", { value: fmt(aVal) })}</span>
                    <Change value={bVal - aVal} pct={percentChange(aVal, bVal)} money={k.money} neutral={k.neutral} />
                  </dd>
                </div>
              );
            })}
          </dl>

          {(faster.length > 0 || slower.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { id: "faster", title: t("compare.movers.faster", { number: numB }), rows: faster, tone: "text-success" },
                { id: "slower", title: t("compare.movers.slower", { number: numB }), rows: slower, tone: "text-destructive" },
              ].map((list) => (
                <section key={list.id} aria-label={list.title} className="flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-4">
                  <h2 className="text-sm font-semibold">{list.title}</h2>
                  {list.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("compare.movers.none")}</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {list.rows.map((r) => (
                        <li key={r.key} className="flex items-baseline justify-between gap-3">
                          <span className="truncate">{r.label}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {rate(r.before)} → <span className={cn("font-medium", list.tone)}>{rate(r.after)}</span> {t("compare.movers.aDay")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label={t("compare.byLabel")} className="inline-flex rounded-lg border p-0.5">
              {(["item", "category"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={by === option}
                  onClick={() => {
                    // An item search means nothing to the category list (and vice versa).
                    setBy(option);
                    setFilter("all");
                    setSearch("");
                  }}
                  className={cn("h-9 rounded-md px-3 text-sm font-medium", by === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {option === "item" ? t("compare.byItem") : t("compare.byCategory")}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={by === "item" ? t("compare.searchItems") : t("compare.searchCategories")}
                placeholder={by === "item" ? t("compare.searchItems") : t("compare.searchCategories")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-9"
              />
            </div>
          </div>

          <FilterChips options={filterOptions} value={filter} onChange={setFilter} counts={counts} />

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("compare.noMatches")}</p>
          ) : (
            <div tabIndex={0} role="region" aria-label={t("compare.tableLabel")} className="overflow-x-auto rounded-2xl border bg-card focus-visible:outline-2 focus-visible:outline-ring">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">{by === "item" ? t("compare.columns.item") : t("compare.columns.category")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("compare.columns.soldIn", { number: numA })}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("compare.columns.soldIn", { number: numB })}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("compare.columns.change")}</th>
                    {SITE_CONFIG.showRevenue && <th className="px-4 py-2.5 text-right font-medium">{t("compare.columns.revenue", { a: numA, b: numB })}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((r) => {
                    const sa = r.soldA * scaleA, sb = r.soldB * scaleB;
                    return (
                      <tr key={r.key}>
                        <td className="max-w-64 px-4 py-2.5">
                          <div className="truncate font-medium">{r.label}</div>
                          <div className="flex gap-2 text-xs text-muted-foreground">
                            {r.isNew && <span>{t("compare.tags.newSeller")}</span>}
                            {r.stopped && <span>{t("compare.tags.stopped")}</span>}
                            {r.soldOutInB && <span className="text-destructive">{t("compare.tags.soldOutIn", { number: numB })}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{Math.round(sa * 10) / 10}</td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">{Math.round(sb * 10) / 10}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Change value={sb - sa} pct={percentChange(sa, sb)} />
                        </td>
                        {SITE_CONFIG.showRevenue && (
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatMoney(r.revenueA * scaleA)} → {formatMoney(r.revenueB * scaleB)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
