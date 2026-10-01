"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCurrentSessionReport } from "@/hooks/use-restock-sessions";
import { formatMoney } from "@/lib/format";
import { useTimeFormat } from "@/lib/time";
import type { CatalogEntry } from "@/lib/types";

export function ItemSession({ item }: { item: CatalogEntry }) {
  const { session, isPending, error, bySku } = useCurrentSessionReport();
  const t = useTranslations("catalog");
  const { timeAgo } = useTimeFormat();

  if (isPending) return <div className="h-24 animate-pulse rounded-xl border bg-muted/40" aria-label={t("session.loading")} />;
  if (error) return null;

  if (!session) {
    return (
      <section aria-label={t("session.title")} className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
        {t.rich("session.noSession", {
          link: (chunks) => (
            <Link href="/restock-sessions" className="text-primary underline underline-offset-2">
              {chunks}
            </Link>
          ),
        })}
      </section>
    );
  }

  const line = bySku.get(item.sku);
  const available = line ? line.openingQuantity + line.restocked : 0;
  const sellThrough = line && available > 0 ? Math.round((line.sold / available) * 100) : null;

  return (
    <section aria-label={t("session.title")} className="flex flex-col gap-3 rounded-xl border px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t("session.title")}</h3>
        <span className="text-xs text-muted-foreground">{t("session.since", { time: timeAgo(session.openedAt) })}</span>
      </div>

      {!line ? (
        <p className="text-sm text-muted-foreground">{t("session.nothingYet")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              { id: "start", label: t("session.start"), value: line.openingQuantity },
              { id: "received", label: t("session.received"), value: `+${line.restocked}` },
              { id: "sold", label: t("session.sold"), value: `−${line.sold}` },
              { id: "now", label: t("session.now"), value: line.closingQuantity },
            ].map((s) => (
              <div key={s.id} className="rounded-lg bg-muted/40 px-1 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              {t("session.revenue")}{" "}
              <span className="font-medium tabular-nums">
                {line.revenue === null ? "—" : `${line.revenueEstimated ? "≈ " : ""}${formatMoney(line.revenue)}`}
              </span>
            </span>
            {sellThrough !== null && (
              <span title={t("session.sellThroughHint")}>
                {t("session.sellThrough")} <span className="font-medium tabular-nums">{sellThrough}%</span>
              </span>
            )}
          </div>
          {line.revenueEstimated && (
            <p className="text-xs text-muted-foreground">{t("session.estimatedNote")}</p>
          )}
        </>
      )}
    </section>
  );
}
