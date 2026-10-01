"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTimeFormat } from "@/lib/time";
import { useState } from "react";
import { NoticeBanner } from "@/components/notice-banner";
import { scanPath, useItemLookup } from "@/hooks/use-item-lookup";
import { useCurrentSessionSales } from "@/hooks/use-restock-sessions";
import { ApiError, apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { ScanItem } from "@/lib/types";
import { ProductCard } from "./product-card";
import { ScanInput } from "./scan-input";

interface Sale {
  id: number;
  name: string;
  quantity: number;
  total: number;
  at: Date;
}

export function ScanAndSell() {
  const t = useTranslations("scan");
  const { formatTime } = useTimeFormat();
  const queryClient = useQueryClient();
  const sessionSales = useCurrentSessionSales();
  const { item, setItem, notice, setNotice, lookup, clear } = useItemLookup();
  const [quantity, setQuantity] = useState(1);
  const [sales, setSales] = useState<Sale[]>([]);

  // The only call that reduces stock, and only fires from the explicit Confirm button.
  const sell = useMutation({
    mutationFn: (current: { barcode: string; quantity: number }) =>
      apiFetch<ScanItem>("gateway", `${scanPath(current.barcode)}/sell`, {
        method: "POST",
        body: JSON.stringify({ quantity: current.quantity }),
      }),
    onSuccess: (updated, sold) => {
      const total = updated.effectivePrice * sold.quantity;
      setSales((previous) =>
        [{ id: Date.now(), name: updated.name, quantity: sold.quantity, total, at: new Date() }, ...previous].slice(0, 8),
      );
      setNotice({
        kind: "success",
        text: t("sold", { quantity: sold.quantity, name: updated.name, left: updated.quantityOnHand ?? 0 }),
      });
      setItem(null);
      // Stock changed, so any cached stock list — and the session's counts — are now stale.
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["restock-sessions"] });
    },
    onError: async (error, sold) => {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : t("saleFailed") });
      // Stock is the usual reason a sale fails (someone else sold it first), so show the
      // current number rather than leaving a stale one on screen.
      if (error instanceof ApiError && error.status === 409) {
        try {
          const fresh = await apiFetch<ScanItem>("gateway", scanPath(sold.barcode));
          setItem(fresh);
          setQuantity(Math.min(sold.quantity, Math.max(fresh.quantityOnHand ?? 1, 1)));
        } catch {
          setItem(null);
        }
      }
    },
  });

  const busy = lookup.isPending || sell.isPending;
  const sessionTotal = sales.reduce((sum, sale) => sum + sale.total, 0);

  function handleScan(code: string) {
    if (busy) return;
    lookup.mutate(code, { onSuccess: () => setQuantity(1) });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <ScanInput onScan={handleScan} disabled={busy} />

        <div className="flex flex-col gap-4" aria-live="polite">
          {notice && <NoticeBanner notice={notice} />}

          {lookup.isPending ? (
            <div className="h-80 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("lookingUp")} />
          ) : item ? (
            <ProductCard
              item={item}
              quantity={quantity}
              onQuantityChange={setQuantity}
              onConfirm={() => sell.mutate({ barcode: item.barcode, quantity })}
              onClear={clear}
              selling={sell.isPending}
              soldThisSession={sessionSales.data?.session ? (sessionSales.data.bySku.get(item.sku)?.sold ?? 0) : null}
            />
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              <ScanLine className="size-8 text-primary/70" />
              {t("readyToScan")}
            </div>
          )}
        </div>
      </div>

      {sales.length > 0 && (
        <section aria-label={t("salesThisSession")} className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">{t("thisSession")}</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{t("sessionTotal", { total: formatMoney(sessionTotal) })}</span>
          </div>
          <ul className="divide-y rounded-xl border bg-card">
            {sales.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  {sale.quantity} × {sale.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMoney(sale.total)} · {formatTime(sale.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
