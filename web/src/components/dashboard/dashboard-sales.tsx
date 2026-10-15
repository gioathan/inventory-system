"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { Button } from "@/components/ui/button";
import { useItems } from "@/hooks/use-items";
import { useRecentDailySales, useRecentSalesByItem } from "@/hooks/use-restock-sessions";
import { runningOut, salesPeriods, type PeriodSales } from "@/lib/dashboard";
import { isoDateToDate } from "@/lib/dated-discounts";
import { formatMoney, formatPercent } from "@/lib/format";
import { percentChange } from "@/lib/restock";
import { SITE_CONFIG } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// Enough days for "this month so far" to be measured against the same days of last month.
const HISTORY_DAYS = 62;
const CHART_DAYS = 30;
const PACE_DAYS = 14;
const BEST_SELLER_DAYS = 7;

// The calendar side of the dashboard: what sold today, this week and this month (each against
// the period before), the last 30 days as a chart, the week's best sellers, and what will run
// out soon at the pace things are selling. Everything else here is organised by restock
// session; this is organised by the calendar, which is how "how are we doing?" is usually meant.
export function DashboardSales() {
  const t = useTranslations("dashboard.sales");
  const format = useFormatter();
  const daily = useRecentDailySales(HISTORY_DAYS);
  const weekByItem = useRecentSalesByItem(BEST_SELLER_DAYS);
  const paceByItem = useRecentSalesByItem(PACE_DAYS);
  const items = useItems();
  const [moneyChoice, setMoney] = useState(true);
  // Revenue can be switched off for the whole site (lib/site-config.ts); then only units show.
  const showRevenue = SITE_CONFIG.showRevenue;
  const money = showRevenue && moneyChoice;

  const days = daily.data ?? [];
  const periods = salesPeriods(days);
  const fmt = (value: number) => (money ? formatMoney(value) : value.toLocaleString());

  const chart = days.slice(-CHART_DAYS).map((d) => {
    const date = isoDateToDate(d.date);
    return {
      key: d.date,
      // Just the day of the month on the axis: thirty columns leave no room for "Oct 10". The
      // full date is in the tooltip and the numbers table.
      label: String(date.getUTCDate()),
      name: format.dateTime(date, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
      value: money ? d.revenue : d.unitsSold,
      detail: money ? t("unitsDetail", { count: d.unitsSold }) : showRevenue ? formatMoney(d.revenue) : undefined,
    };
  });

  const bestSellers = [...(weekByItem.data ?? [])]
    .sort((a, b) => (money ? b.revenue - a.revenue : b.unitsSold - a.unitsSold))
    .slice(0, 6)
    .map((s) => ({
      key: s.sku,
      label: s.name ?? s.sku,
      value: money ? s.revenue : s.unitsSold,
      detail: money ? t("unitsDetail", { count: s.unitsSold }) : showRevenue ? formatMoney(s.revenue) : undefined,
    }));

  // The pace is measured over the days the shop has actually been selling, up to two weeks.
  const firstSale = days.findIndex((d) => d.unitsSold > 0);
  const span = firstSale === -1 ? PACE_DAYS : Math.min(PACE_DAYS, days.length - firstSale);
  const soon = runningOut(items.data ?? [], paceByItem.data ?? [], span);

  if (daily.isError) {
    return (
      <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {t("loadError", { message: daily.error.message })}
      </p>
    );
  }

  return (
    <section aria-labelledby="sales-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sales-heading" className="text-lg font-semibold tracking-tight">
          {t("title")}
        </h2>
        {showRevenue && (
        <div role="group" aria-label={t("measureLabel")} className="flex gap-2">
          <Button type="button" variant={money ? "default" : "outline"} className="h-8" aria-pressed={money} onClick={() => setMoney(true)}>
            {t("revenue")}
          </Button>
          <Button type="button" variant={money ? "outline" : "default"} className="h-8" aria-pressed={!money} onClick={() => setMoney(false)}>
            {t("units")}
          </Button>
        </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {periods ? (
          <>
            <Period label={t("today")} period={periods.today} versus={t("versus.yesterday")} money={money} showRevenue={showRevenue} />
            <Period label={t("week")} period={periods.week} versus={t("versus.weekBefore")} money={money} showRevenue={showRevenue} />
            <Period label={t("month")} period={periods.month} versus={t("versus.lastMonth")} money={money} showRevenue={showRevenue} />
          </>
        ) : (
          Array.from({ length: 3 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loading")} />)
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold">{money ? t("chartRevenue", { days: CHART_DAYS }) : t("chartUnits", { days: CHART_DAYS })}</h3>
          {chart.length > 1 ? (
            <ColumnChart title={t("chartLabel")} points={chart} format={fmt} valueHeader={money ? t("revenue") : t("units")} labelHeader={t("day")} />
          ) : (
            <div className="h-40 animate-pulse rounded-xl bg-muted/40" aria-label={t("loading")} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold">{t("bestSellers", { days: BEST_SELLER_DAYS })}</h3>
          <BarList title={t("item")} rows={bestSellers} format={fmt} valueHeader={money ? t("revenue") : t("units")} emptyText={t("noSales", { days: BEST_SELLER_DAYS })} />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{t("runningOut.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("runningOut.explanation", { days: span })}</p>
        </div>
        {soon.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">{t("runningOut.none")}</p>
        ) : (
          <ul className="divide-y">
            {soon.map(({ item, perDay, daysLeft }) => (
              // Stacked on phones: the detail is a sentence, too long to sit beside a name there.
              <li key={item.sku} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{item.name}</span>
                  {item.location && <span className="text-xs text-muted-foreground"> · {item.location}</span>}
                </span>
                <span className="tabular-nums text-muted-foreground sm:shrink-0 sm:text-right">
                  <span className={cn("font-medium", daysLeft < 3 ? "text-destructive" : "text-warning")}>
                    {daysLeft < 1 ? t("runningOut.lessThanADay") : t("runningOut.daysLeft", { days: Math.floor(daysLeft) })}
                  </span>
                  {" · "}
                  {t("runningOut.detail", { stock: item.quantityOnHand ?? 0, perDay: perDay.toLocaleString(undefined, { maximumFractionDigits: 1 }) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Period({ label, period, versus, money, showRevenue }: { label: string; period: PeriodSales; versus: string; money: boolean; showRevenue: boolean }) {
  const t = useTranslations("dashboard.sales");
  const now = money ? period.revenue : period.units;
  const before = money ? period.previousRevenue : period.previousUnits;
  const change = percentChange(before, now);
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight">{money ? formatMoney(period.revenue) : period.units.toLocaleString()}</div>
      {(money || showRevenue) && (
        <div className="text-xs tabular-nums text-muted-foreground">{money ? t("unitsDetail", { count: period.units }) : formatMoney(period.revenue)}</div>
      )}
      {change === null ? (
        <div className="text-xs text-muted-foreground">{now === 0 ? t("change.nothingEither", { versus }) : t("change.noBaseline", { versus })}</div>
      ) : (
        <div className={cn("flex items-center gap-1 text-xs font-medium", change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground")}>
          {change > 0 ? <ArrowUp className="size-3" /> : change < 0 ? <ArrowDown className="size-3" /> : null}
          {change === 0 ? t("change.same", { versus }) : t("change.moved", { percent: formatPercent(Math.abs(change)), direction: change > 0 ? "up" : "down", versus })}
        </div>
      )}
    </div>
  );
}
