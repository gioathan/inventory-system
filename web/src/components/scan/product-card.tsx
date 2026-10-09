"use client";

import { Loader2, Minus, Plus, ShoppingBag, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format";
import { stockLevel } from "@/lib/stock";
import type { ScanItem } from "@/lib/types";

interface ProductCardProps {
  item: ScanItem;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  onConfirm: () => void;
  onClear: () => void;
  selling: boolean;
  /** Units sold in the open restock session; null when no session is open. */
  soldThisSession?: number | null;
}

export function ProductCard({ item, quantity, onQuantityChange, onConfirm, onClear, selling, soldThisSession = null }: ProductCardProps) {
  const t = useTranslations("scan.product");
  const tc = useTranslations("common");
  const level = stockLevel(item.quantityOnHand);
  const inStock = item.quantityOnHand ?? 0;
  const discounted = item.activeDiscountPercentage !== null;
  const total = item.effectivePrice * quantity;
  const canSell = level !== "out";

  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {level === "out" && (
          <StatusPill tone="danger">{item.quantityOnHand === null ? tc("stockLevel.notStockedYet") : tc("stockLevel.outOfStock")}</StatusPill>
        )}
        {level === "low" && <StatusPill tone="warning">{t("lowStockLeft", { count: inStock })}</StatusPill>}
        {level === "ok" && <StatusPill tone="success">{t("inStockUnits", { count: inStock })}</StatusPill>}
        {soldThisSession !== null && <span className="text-xs text-muted-foreground">{t("soldThisSession", { count: soldThisSession })}</span>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{item.sku}</span>
      </div>

      <div className="flex gap-4">
        <ItemImage src={item.imageUrl} alt={item.name} zoomable />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{item.name}</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{item.barcode}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-1 rounded-xl bg-muted/50 px-4 py-3">
        <div className="text-4xl font-semibold tabular-nums tracking-tight">{formatMoney(item.effectivePrice)}</div>
        {discounted && (
          <>
            <div className="pb-1 text-sm tabular-nums text-muted-foreground line-through">{formatMoney(item.price)}</div>
            <StatusPill tone="warning" className="mb-1">
              <Tag className="size-3" />
              {t("percentOff", { percent: formatPercent(item.activeDiscountPercentage!) })}
            </StatusPill>
          </>
        )}
      </div>

      {canSell ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("quantity")}</div>
              <div className="text-sm tabular-nums text-muted-foreground">{t("total", { total: formatMoney(total) })}</div>
            </div>
            <div className="flex items-center gap-1 rounded-xl border bg-background p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("decrease")}
                className="size-11"
                disabled={quantity <= 1 || selling}
                onClick={() => onQuantityChange(quantity - 1)}
              >
                <Minus className="size-4" />
              </Button>
              <output aria-live="polite" className="w-10 text-center text-lg font-semibold tabular-nums">
                {quantity}
              </output>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("increase")}
                className="size-11"
                disabled={quantity >= inStock || selling}
                onClick={() => onQuantityChange(quantity + 1)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {/* The commit step is always its own deliberate tap; scanning never sells by itself. */}
          <Button type="button" className="h-14 text-base font-semibold" disabled={selling} onClick={onConfirm}>
            {selling ? <Loader2 className="size-5 animate-spin" /> : <ShoppingBag className="size-5" />}
            {t("confirmSale", { total: formatMoney(total) })}
          </Button>
        </>
      ) : (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("cantSell")}
        </p>
      )}

      <Button type="button" variant="ghost" className="h-11" disabled={selling} onClick={onClear}>
        {t("clear")}
      </Button>
    </div>
  );
}
