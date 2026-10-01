"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { niceMax } from "@/lib/restock";
import { cn } from "@/lib/utils";

export interface ColumnPoint {
  key: string;
  /** Short axis label, e.g. "#12". */
  label: string;
  /** Full name for the tooltip and table. */
  name: string;
  value: number;
  detail?: string;
}

// A single-series column chart over an ordered axis (sessions, oldest to newest). One color,
// no legend box. Columns are capped at 24px wide with a 4px rounded cap and a square base,
// on hairline gridlines at 0 / half / max. Only the latest column is labeled on its cap; the
// axis, the per-column tooltip (hover or keyboard focus) and the table carry the rest.
export function ColumnChart({
  title,
  points,
  format,
  valueHeader,
}: {
  title: string;
  points: ColumnPoint[];
  format: (value: number) => string;
  valueHeader: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  // Only the Insights tab uses these charts today, so their few built-in strings live in "restock".
  const t = useTranslations("restock");
  const top = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = [top, top / 2, 0];
  // Past ~12 columns, label every other one so axis labels never collide.
  const every = points.length > 12 ? Math.ceil(points.length / 12) : 1;
  const latest = points.at(-1)?.key;

  return (
    <figure className="flex flex-col gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* y-axis tick labels, aligned to the gridlines */}
        <div className="relative h-48 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden>
          {ticks.map((tick, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(i / 2) * 100}%` }}>
              {format(tick)}
            </span>
          ))}
          <span className="invisible block">{format(top)}</span>
        </div>

        <div className="relative h-48">
          {ticks.map((_, i) => (
            <div key={i} aria-hidden className="absolute inset-x-0 border-t border-border" style={{ top: `${(i / 2) * 100}%` }} />
          ))}
          <ul aria-label={title} className="absolute inset-0 flex items-end gap-1 px-1">
            {points.map((p, index) => {
              const pct = (p.value / top) * 100;
              const isActive = active === p.key;
              // Anchor the tooltip toward the chart's middle so edge columns never push it off-screen.
              const anchor = index < points.length / 2 ? "left-0" : "right-0";
              return (
                <li
                  key={p.key}
                  tabIndex={0}
                  aria-label={`${p.name}: ${format(p.value)}${p.detail ? `, ${p.detail}` : ""}`}
                  onPointerEnter={() => setActive(p.key)}
                  onPointerLeave={() => setActive((k) => (k === p.key ? null : k))}
                  onFocus={() => setActive(p.key)}
                  onBlur={() => setActive((k) => (k === p.key ? null : k))}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {p.key === latest && p.value > 0 && (
                    <span className="absolute -translate-y-full pb-1 text-[11px] font-medium tabular-nums text-foreground" style={{ bottom: `${pct}%` }}>
                      {format(p.value)}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={cn("w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity", isActive && "opacity-80")}
                    style={{ height: p.value > 0 ? `max(${pct}%, 2px)` : 0 }}
                  />
                  {isActive && (
                    <span
                      role="tooltip"
                      // Just above the column's cap (inside the plot), not above the whole chart.
                      style={{ bottom: `min(calc(${pct}% + 0.5rem), calc(100% - 3.5rem))` }}
                      className={cn(
                        "pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md",
                        anchor,
                      )}
                    >
                      <strong className="block font-semibold">{format(p.value)}</strong>
                      <span className="text-muted-foreground">{p.name}</span>
                      {p.detail && <span className="block text-muted-foreground">{p.detail}</span>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* x-axis band sits outside the fixed-height plot, so the card grows instead of scrolling */}
        <div />
        <div className="flex gap-1 px-1 pt-1.5 text-[11px] tabular-nums text-muted-foreground" aria-hidden>
          {points.map((p, i) => (
            <span key={p.key} className="min-w-0 flex-1 truncate text-center">
              {i % every === 0 || p.key === latest ? p.label : ""}
            </span>
          ))}
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t("charts.showNumbers")}</summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">{t("charts.session")}</th>
              <th className="py-1.5 text-right font-medium">{valueHeader}</th>
              <th className="py-1.5 pl-3 text-right font-medium">{t("charts.other")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {points.map((p) => (
              <tr key={p.key}>
                <td className="max-w-56 truncate py-1.5">{p.name}</td>
                <td className="py-1.5 text-right tabular-nums">{format(p.value)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">{p.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
