import type { RestockSession, SessionReportLine } from "./types";

export type NumberedSession = RestockSession & { number: number };

// The API lists sessions newest first; number them oldest-first so "#7" stays #7 as more are added.
export function numberSessions(sessions: RestockSession[]): NumberedSession[] {
  return sessions.map((s, index) => ({ ...s, number: sessions.length - index }));
}

export function sessionLabel(s: NumberedSession): string {
  const date = new Date(s.openedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `#${s.number} · ${date}${s.note ? ` · ${s.note}` : ""}${s.closedAt === null ? " (open)" : ""}`;
}

// Length in days for per-day figures. Anything shorter than a day counts as one day, so a
// 10-minute session doesn't turn 3 sales into "432 a day".
export function sessionDays(s: RestockSession, now = Date.now()): number {
  const ms = new Date(s.closedAt ?? now).getTime() - new Date(s.openedAt).getTime();
  return Math.max(1, ms / 86_400_000);
}

export interface SessionTotals {
  received: number;
  sold: number;
  revenue: number;
  itemsSold: number;
  /** Sold ÷ (stock at start + received), over every item that moved. Null when nothing was available. */
  sellThrough: number | null;
  estimated: boolean;
}

export function totalsOf(lines: SessionReportLine[]): SessionTotals {
  let received = 0, sold = 0, revenue = 0, itemsSold = 0, available = 0, estimated = false;
  for (const l of lines) {
    received += l.restocked;
    sold += l.sold;
    revenue += l.revenue ?? 0;
    available += l.openingQuantity + l.restocked;
    if (l.sold > 0) itemsSold++;
    if (l.revenueEstimated) estimated = true;
  }
  return { received, sold, revenue, itemsSold, sellThrough: available > 0 ? sold / available : null, estimated };
}

/** % change from a to b; null when there's no baseline to compare against. */
export function percentChange(a: number, b: number): number | null {
  if (a === 0) return null;
  return (b - a) / a;
}

export interface ComparedRow {
  key: string;
  label: string;
  soldA: number;
  soldB: number;
  revenueA: number;
  revenueB: number;
  change: number;
  pct: number | null;
  /** Sold in B but not in A. */
  isNew: boolean;
  /** Sold in A but not in B. */
  stopped: boolean;
  /** Ended B with no stock left — demand B couldn't meet. */
  soldOutInB: boolean;
}

function compareBy(
  a: SessionReportLine[],
  b: SessionReportLine[],
  keyOf: (l: SessionReportLine) => string,
  labelOf: (key: string, sample: SessionReportLine) => string,
): ComparedRow[] {
  const rows = new Map<string, ComparedRow>();
  const row = (l: SessionReportLine) => {
    const key = keyOf(l);
    let r = rows.get(key);
    if (!r) {
      r = { key, label: labelOf(key, l), soldA: 0, soldB: 0, revenueA: 0, revenueB: 0, change: 0, pct: null, isNew: false, stopped: false, soldOutInB: false };
      rows.set(key, r);
    }
    return r;
  };
  for (const l of a) {
    const r = row(l);
    r.soldA += l.sold;
    r.revenueA += l.revenue ?? 0;
  }
  for (const l of b) {
    const r = row(l);
    r.soldB += l.sold;
    r.revenueB += l.revenue ?? 0;
    if (l.closingQuantity === 0 && l.sold > 0) r.soldOutInB = true;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, change: r.soldB - r.soldA, pct: percentChange(r.soldA, r.soldB), isNew: r.soldA === 0 && r.soldB > 0, stopped: r.soldA > 0 && r.soldB === 0 }))
    .filter((r) => r.soldA > 0 || r.soldB > 0);
}

export function compareItems(a: SessionReportLine[], b: SessionReportLine[]): ComparedRow[] {
  return compareBy(a, b, (l) => l.sku, (_, l) => l.name ?? l.sku);
}

export function compareCategories(a: SessionReportLine[], b: SessionReportLine[], categoryName: (id: string) => string | undefined): ComparedRow[] {
  return compareBy(
    a,
    b,
    (l) => l.categoryId ?? "none",
    (key) => (key === "none" ? "No category" : (categoryName(key) ?? "Unknown category")),
  );
}
