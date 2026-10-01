"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Extra line for the tooltip and table (e.g. the other measure). */
  detail?: string;
}

// A ranked horizontal bar list: one series, so every bar takes the same chart-1 color and there's
// no legend box (the card title names what's plotted). Bars grow from a shared baseline, capped
// at 16px thick with a 4px rounded tip and a square base; the value sits at the tip in text ink.
// Each row is focusable and shows a tooltip; the table under the chart carries every value too.
export function BarList({
  title,
  rows,
  format,
  valueHeader,
  emptyText,
}: {
  title: string;
  rows: BarRow[];
  format: (value: number) => string;
  valueHeader: string;
  emptyText: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  // Only the Insights tab uses these charts today, so their few built-in strings live in "restock".
  const t = useTranslations("restock");
  const max = Math.max(0, ...rows.map((r) => r.value));

  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <figure className="flex flex-col gap-3">
      <ul aria-label={title} className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const pct = max > 0 ? (row.value / max) * 100 : 0;
          const isActive = active === row.key;
          return (
            <li
              key={row.key}
              tabIndex={0}
              aria-label={`${row.label}: ${format(row.value)}${row.detail ? `, ${row.detail}` : ""}`}
              onPointerEnter={() => setActive(row.key)}
              onPointerLeave={() => setActive((k) => (k === row.key ? null : k))}
              onFocus={() => setActive(row.key)}
              onBlur={() => setActive((k) => (k === row.key ? null : k))}
              className="relative grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 rounded-md py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
            >
              <span className="truncate text-sm" title={row.label}>
                {row.label}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn("h-4 rounded-r-[4px] bg-chart-1 transition-opacity", isActive ? "opacity-80" : "opacity-100")}
                  // Scale within the track minus room for the value label, so lengths stay proportional.
                  style={{ width: `max(calc((100% - 5rem) * ${pct / 100}), 2px)` }}
                />
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{format(row.value)}</span>
              </span>
              {isActive && row.detail && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute -top-9 left-0 z-10 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
                >
                  <strong className="font-semibold">{format(row.value)}</strong> · {row.detail}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t("charts.showNumbers")}</summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">{title}</th>
              <th className="py-1.5 text-right font-medium">{valueHeader}</th>
              <th className="py-1.5 pl-3 text-right font-medium">{t("charts.other")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="max-w-48 truncate py-1.5">{row.label}</td>
                <td className="py-1.5 text-right tabular-nums">{format(row.value)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">{row.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
