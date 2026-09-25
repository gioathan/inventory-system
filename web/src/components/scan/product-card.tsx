"use client";

import { Loader2, Minus, Plus, ShoppingBag, Tag } from "lucide-react";
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
}

export function ProductCard({ item, quantity, onQuantityChange, onConfirm, onClear, selling }: ProductCardProps) {
  const level = stockLevel(item.quantityOnHand);
  const inStock = item.quantityOnHand ?? 0;
  const discounted = item.discountPercentage !== null;
  const total = item.effectivePrice * quantity;
  const canSell = level !== "out";

  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {level === "out" && (
          <StatusPill tone="danger">{item.quantityOnHand === null ? "Not stocked yet" : "Out of stock"}</StatusPill>
        )}
        {level === "low" && <StatusPill tone="warning">Low stock · {inStock} left</StatusPill>}
        {level === "ok" && <StatusPill tone="success">In stock · {inStock} units</StatusPill>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{item.sku}</span>
      </div>

      <div className="flex gap-4">
        <ItemImage src={item.imageUrl} alt={item.name} />
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
              {formatPercent(item.discountPercentage!)} off
            </StatusPill>
          </>
        )}
      </div>

      {canSell ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Quantity</div>
              <div className="text-sm tabular-nums text-muted-foreground">Total {formatMoney(total)}</div>
            </div>
            <div className="flex items-center gap-1 rounded-xl border bg-background p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Decrease quantity"
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
                aria-label="Increase quantity"
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
            Confirm sale · {formatMoney(total)}
          </Button>
        </>
      ) : (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          This item can&apos;t be sold right now — there&apos;s no stock on hand.
        </p>
      )}

      <Button type="button" variant="ghost" className="h-11" disabled={selling} onClick={onClear}>
        Clear · scan next item
      </Button>
    </div>
  );
}
