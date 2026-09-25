"use client";

import { PackagePlus, Printer, Tag, X } from "lucide-react";
import Link from "next/link";
import { ItemImage } from "@/components/item-image";
import { Label } from "@/components/labels/label";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format";
import { LABEL_FORMAT, LABEL_HEIGHT_IN, LABEL_WIDTH_IN } from "@/lib/label";
import { stockLevel } from "@/lib/stock";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const FORMAT_NOTE = {
  both: "Code128 + QR",
  code128: "Code128",
  qr: "QR",
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

export function ItemPanel({
  item,
  categoryName,
  onClose,
}: {
  item: CatalogEntry;
  categoryName: string | null;
  /** Shown only when the panel is a docked column; inside a sheet the sheet has its own close. */
  onClose?: () => void;
}) {
  const level = stockLevel(item.quantityOnHand);
  const discounted = item.discountPercentage !== null;

  return (
    <div className="flex flex-col gap-5">
      <div className={cn("flex items-start gap-3", !onClose && "pr-8")}>
        <ItemImage src={item.imageUrl} alt={item.name} className="size-20" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">{item.name}</h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{item.sku}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-semibold tabular-nums">{formatMoney(item.effectivePrice)}</span>
            {discounted && (
              <>
                <span className="text-xs tabular-nums text-muted-foreground line-through">{formatMoney(item.price)}</span>
                <StatusPill tone="warning" className="px-2 py-0.5">
                  <Tag className="size-3" />
                  {formatPercent(item.discountPercentage!)} off
                </StatusPill>
              </>
            )}
          </div>
        </div>
        {onClose && (
          <Button type="button" variant="ghost" size="icon" aria-label="Close details" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      <dl className="divide-y rounded-xl border px-4">
        <Field label="Stock">
          {level === "out" ? (
            <StatusPill tone="danger">{item.quantityOnHand === null ? "Not stocked yet" : "Out of stock"}</StatusPill>
          ) : level === "low" ? (
            <StatusPill tone="warning">Low · {item.quantityOnHand} left</StatusPill>
          ) : (
            <StatusPill tone="success">{item.quantityOnHand} in stock</StatusPill>
          )}
        </Field>
        <Field label="Category">{categoryName ?? <span className="text-muted-foreground">None</span>}</Field>
        <Field label="Barcode">
          <span className="font-mono text-xs">{item.barcode}</span>
        </Field>
        <Field label="List price">{formatMoney(item.price)}</Field>
      </dl>

      <section aria-label="Label preview" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Label</h3>
          <span className="text-xs text-muted-foreground">
            {FORMAT_NOTE[LABEL_FORMAT]} · {LABEL_WIDTH_IN}&Prime; × {LABEL_HEIGHT_IN}&Prime;
          </span>
        </div>
        {/* Rendered at its real size then scaled, so proportions match what will print. The scale
            steps down on narrow screens so the whole label stays visible instead of clipping. */}
        <div className="overflow-x-auto rounded-xl border bg-muted/40 p-3 [--scale:1.15] min-[420px]:[--scale:1.5]">
          <div style={{ width: `calc(${LABEL_WIDTH_IN}in * var(--scale))`, height: `calc(${LABEL_HEIGHT_IN}in * var(--scale))` }}>
            <div style={{ transform: "scale(var(--scale))", transformOrigin: "top left" }}>
              <Label item={item} format={LABEL_FORMAT} className="shadow-sm" />
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/labels/print?sku=${encodeURIComponent(item.sku)}`}
          className={cn(buttonVariants(), "h-10 flex-1 gap-2")}
        >
          <Printer className="size-4" />
          Print label
        </Link>
        <Link
          href={`/receive?barcode=${encodeURIComponent(item.barcode)}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 flex-1 gap-2")}
        >
          <PackagePlus className="size-4" />
          Receive stock
        </Link>
      </div>
    </div>
  );
}
