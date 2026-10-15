import { stockLevel } from "./stock";
import type { CatalogEntry, DailySales, ItemSales } from "./types";

export interface DashboardStats {
  skus: number;
  onPromo: number;
  unitsOnHand: number;
  /** Stock at what customers currently pay (discounts included). Not cost: the backend has none. */
  retailValue: number;
  inStock: number;
  low: number;
  out: number;
}

export function computeStats(items: CatalogEntry[]): DashboardStats {
  let unitsOnHand = 0;
  let retailValue = 0;
  let inStock = 0, low = 0, out = 0, onPromo = 0;

  for (const item of items) {
    const quantity = item.quantityOnHand ?? 0;
    unitsOnHand += quantity;
    retailValue += quantity * item.effectivePrice;
    if (item.activeDiscountPercentage !== null) onPromo++;
    const level = stockLevel(item.quantityOnHand);
    if (level === "ok") inStock++;
    else if (level === "low") low++;
    else out++;
  }

  return { skus: items.length, onPromo, unitsOnHand, retailValue, inStock, low, out };
}

// What needs reordering: low items, lowest first, then items that hit zero. Items that have never
// been stocked (quantity null) are deliberately left out — they're catalog entries nobody has
// received yet, not stock that ran out, and on a real catalog they'd bury the genuine shortages.
export function needsAttention(items: CatalogEntry[], limit = 8): CatalogEntry[] {
  return items
    .filter((i) => i.quantityOnHand !== null && stockLevel(i.quantityOnHand) !== "ok")
    .sort((a, b) => (a.quantityOnHand ?? 0) - (b.quantityOnHand ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export interface PeriodSales {
  units: number;
  revenue: number;
  /** The same figures for the period it is measured against. */
  previousUnits: number;
  previousRevenue: number;
}

export interface SalesPeriods {
  today: PeriodSales;
  /** The last 7 days including today, against the 7 before. */
  week: PeriodSales;
  /** This calendar month so far, against the same days of last month. */
  month: PeriodSales;
}

// Calendar figures from per-day sales (oldest first, the last entry being today). Needs about
// two months of days to fill every comparison; shorter input just compares against zeros.
export function salesPeriods(days: DailySales[]): SalesPeriods | null {
  if (days.length === 0) return null;
  const sum = (list: DailySales[]) => list.reduce((acc, d) => ({ units: acc.units + d.unitsSold, revenue: acc.revenue + d.revenue }), { units: 0, revenue: 0 });
  const period = (current: DailySales[], previous: DailySales[]): PeriodSales => {
    const now = sum(current), before = sum(previous);
    return { units: now.units, revenue: now.revenue, previousUnits: before.units, previousRevenue: before.revenue };
  };

  const today = days[days.length - 1];
  const monthOf = (d: DailySales) => d.date.slice(0, 7);
  const dayOf = (d: DailySales) => Number(d.date.slice(8, 10));
  const [year, month] = today.date.split("-").map(Number);
  const lastMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;

  return {
    today: period([today], days.slice(-2, -1)),
    week: period(days.slice(-7), days.slice(-14, -7)),
    month: period(
      days.filter((d) => monthOf(d) === monthOf(today)),
      days.filter((d) => monthOf(d) === lastMonth && dayOf(d) <= dayOf(today)),
    ),
  };
}

export interface RunningOut {
  item: CatalogEntry;
  /** Units a day, at the recent pace. */
  perDay: number;
  /** Days until it reaches zero at that pace. */
  daysLeft: number;
}

// Items that will run out soon if they keep selling as they have: stock ÷ recent units per day.
// More useful than a fixed "5 or fewer" line — 5 left of something that sells once a month is
// fine, 20 left of something selling 10 a day is not. `windowDays` is how many days `sales`
// covers; when the shop's history is shorter than that, pass the shorter span so a busy first
// week isn't diluted over days that had no chance of a sale.
export function runningOut(items: CatalogEntry[], sales: ItemSales[], windowDays: number, horizonDays = 7, limit = 8): RunningOut[] {
  const soldBySku = new Map(sales.map((s) => [s.sku, s.unitsSold]));
  const span = Math.max(1, windowDays);
  return items
    .flatMap((item) => {
      const sold = soldBySku.get(item.sku) ?? 0;
      const quantity = item.quantityOnHand ?? 0;
      if (sold === 0 || quantity === 0) return [];
      const perDay = sold / span;
      return [{ item, perDay, daysLeft: quantity / perDay }];
    })
    .filter((r) => r.daysLeft <= horizonDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}
