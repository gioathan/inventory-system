"use client";

import Link from "next/link";
import { useCurrentSessionReport } from "@/hooks/use-restock-sessions";
import { formatMoney } from "@/lib/format";
import { timeAgo } from "@/lib/time";
import type { CatalogEntry } from "@/lib/types";

export function ItemSession({ item }: { item: CatalogEntry }) {
  const { session, isPending, error, bySku } = useCurrentSessionReport();

  if (isPending) return <div className="h-24 animate-pulse rounded-xl border bg-muted/40" aria-label="Loading this session" />;
  if (error) return null;

  if (!session) {
    return (
      <section aria-label="This session" className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
        No restock session open.{" "}
        <Link href="/restock-sessions" className="text-primary underline underline-offset-2">
          Start one
        </Link>{" "}
        to track this item per delivery.
      </section>
    );
  }

  const line = bySku.get(item.sku);
  const available = line ? line.openingQuantity + line.restocked : 0;
  const sellThrough = line && available > 0 ? Math.round((line.sold / available) * 100) : null;

  return (
    <section aria-label="This session" className="flex flex-col gap-3 rounded-xl border px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">This session</h3>
        <span className="text-xs text-muted-foreground">since {timeAgo(session.openedAt)}</span>
      </div>

      {!line ? (
        <p className="text-sm text-muted-foreground">Nothing received or sold yet in this session.</p>
      ) : (
        <>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Start", value: line.openingQuantity },
              { label: "Received", value: `+${line.restocked}` },
              { label: "Sold", value: `−${line.sold}` },
              { label: "Now", value: line.closingQuantity },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-muted/40 px-1 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              Revenue{" "}
              <span className="font-medium tabular-nums">
                {line.revenue === null ? "—" : `${line.revenueEstimated ? "≈ " : ""}${formatMoney(line.revenue)}`}
              </span>
            </span>
            {sellThrough !== null && (
              <span title="Share of the stock available this session (start + received) that has sold">
                Sell-through <span className="font-medium tabular-nums">{sellThrough}%</span>
              </span>
            )}
          </div>
          {line.revenueEstimated && (
            <p className="text-xs text-muted-foreground">≈ includes sales made before prices were recorded, valued at today&apos;s price.</p>
          )}
        </>
      )}
    </section>
  );
}
