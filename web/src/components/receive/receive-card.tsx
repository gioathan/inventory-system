"use client";

import { Loader2, Minus, PackagePlus, Plus } from "lucide-react";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stockLevel } from "@/lib/stock";
import type { ScanItem } from "@/lib/types";

export const MAX_RECEIVE_QUANTITY = 99_999;
const PRESETS = [1, 5, 10, 20];

interface ReceiveCardProps {
  item: ScanItem;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  onConfirm: () => void;
  onClear: () => void;
  receiving: boolean;
}

export function ReceiveCard({ item, quantity, onQuantityChange, onConfirm, onClear, receiving }: ReceiveCardProps) {
  const onHand = item.quantityOnHand ?? 0;
  const level = stockLevel(item.quantityOnHand);
  const valid = quantity >= 1 && quantity <= MAX_RECEIVE_QUANTITY;
  const clamp = (value: number) => Math.max(0, Math.min(MAX_RECEIVE_QUANTITY, value));

  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={level === "ok" ? "success" : level === "low" ? "warning" : "neutral"}>
          {item.quantityOnHand === null ? "Not stocked yet" : `On hand · ${onHand}`}
        </StatusPill>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{item.sku}</span>
      </div>

      <div className="flex gap-4">
        <ItemImage src={item.imageUrl} alt={item.name} />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{item.name}</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{item.barcode}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label htmlFor="receive-quantity" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quantity to add
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Decrease quantity"
            className="size-12"
            disabled={quantity <= 1 || receiving}
            onClick={() => onQuantityChange(clamp(quantity - 1))}
          >
            <Minus className="size-4" />
          </Button>
          <Input
            id="receive-quantity"
            inputMode="numeric"
            autoComplete="off"
            value={quantity === 0 ? "" : String(quantity)}
            onChange={(event) => onQuantityChange(clamp(Number(event.target.value.replace(/\D/g, "")) || 0))}
            disabled={receiving}
            className="h-12 flex-1 text-center text-xl font-semibold tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Increase quantity"
            className="size-12"
            disabled={quantity >= MAX_RECEIVE_QUANTITY || receiving}
            onClick={() => onQuantityChange(clamp(quantity + 1))}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        {/* Quick adds for counting in cartons or pallets rather than tapping + repeatedly. */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick add">
          <span className="text-xs text-muted-foreground">Add</span>
          {PRESETS.map((amount) => (
            <Button
              key={amount}
              type="button"
              variant="secondary"
              className="h-10 min-w-12 px-3"
              disabled={receiving}
              onClick={() => onQuantityChange(clamp(quantity + amount))}
            >
              +{amount}
            </Button>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          New total{" "}
          <span className="font-semibold tabular-nums text-foreground">{valid ? onHand + quantity : "—"}</span>
        </p>
      </div>

      <Button type="button" className="h-14 text-base font-semibold" disabled={!valid || receiving} onClick={onConfirm}>
        {receiving ? <Loader2 className="size-5 animate-spin" /> : <PackagePlus className="size-5" />}
        Add {valid ? quantity : ""} to stock
      </Button>

      <Button type="button" variant="ghost" className="h-11" disabled={receiving} onClick={onClear}>
        Clear · scan next item
      </Button>
    </div>
  );
}
