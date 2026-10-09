"use client";

import { PackagePlus, Pencil, Printer, Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { ItemImage } from "@/components/item-image";
import { Label } from "@/components/labels/label";
import { useDatedDiscounts } from "@/hooks/use-admin-data";
import { useDateRangeLabel } from "./dated-discounts";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format";
import { DEFAULT_LABEL_SIZE, LABEL_FORMAT } from "@/lib/label";
import { stockLevel } from "@/lib/stock";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QuickReceiveDialog } from "@/components/receive/quick-receive-dialog";
import { EditItemDialog } from "./edit-item-dialog";
import { ItemSession } from "./item-session";

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
  const discounted = item.activeDiscountPercentage !== null;
  const rangeLabel = useDateRangeLabel();
  const dated = (useDatedDiscounts().data ?? []).filter((d) => d.skus.includes(item.sku));
  const [editOpen, setEditOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const t = useTranslations("catalog");
  const tc = useTranslations("common");

  return (
    <div className="flex flex-col gap-5">
      <div className={cn("flex items-start gap-3", !onClose && "pr-8")}>
        <ItemImage src={item.imageUrl} alt={item.name} className="size-20" zoomable />
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
                  {t("percentOff", { percent: formatPercent(item.activeDiscountPercentage!) })}
                </StatusPill>
              </>
            )}
          </div>
        </div>
        {onClose && (
          <Button type="button" variant="ghost" size="icon" aria-label={t("panel.closeDetails")} onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      <dl className="divide-y rounded-xl border px-4">
        <Field label={t("fields.stock")}>
          {level === "out" ? (
            <StatusPill tone="danger">{item.quantityOnHand === null ? tc("stockLevel.notStockedYet") : tc("stockLevel.outOfStock")}</StatusPill>
          ) : level === "low" ? (
            <StatusPill tone="warning">{t("panel.lowLeft", { count: item.quantityOnHand! })}</StatusPill>
          ) : (
            <StatusPill tone="success">{t("panel.inStock", { count: item.quantityOnHand! })}</StatusPill>
          )}
        </Field>
        <Field label={t("fields.category")}>{categoryName ?? <span className="text-muted-foreground">{t("panel.none")}</span>}</Field>
        <Field label={t("fields.barcode")}>
          <span className="font-mono text-xs">{item.barcode}</span>
        </Field>
        <Field label={t("fields.listPrice")}>{formatMoney(item.price)}</Field>
      </dl>

      {dated.length > 0 && (
        <section aria-label={t("panel.datedDiscounts")} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("panel.datedDiscounts")}</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {dated.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusPill tone={d.activeToday ? "success" : "neutral"} className="px-2 py-0.5">
                  {t("percentOff", { percent: formatPercent(d.percentage) })}
                </StatusPill>
                <Link href="/discounts" className="font-medium underline-offset-2 hover:underline">
                  {d.name}
                </Link>
                {d.nextStart && d.nextEnd && <span className="text-muted-foreground">{rangeLabel(d.nextStart, d.nextEnd)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ItemSession item={item} />

      <section aria-label={t("panel.labelPreview")} className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">{t("panel.label")}</h3>
          <span className="text-xs text-muted-foreground">
            {FORMAT_NOTE[LABEL_FORMAT]} · {DEFAULT_LABEL_SIZE.widthMm} × {DEFAULT_LABEL_SIZE.heightMm} mm
          </span>
        </div>
        {/* Rendered at its real size then scaled, so proportions match what will print. The scale
            steps down on narrow screens so the whole label stays visible instead of clipping. */}
        {/* tabIndex + a name: a scrollable area must be reachable by keyboard, or its overflow is unreachable for anyone not using a mouse. */}
        <div
          tabIndex={0}
          role="region"
          aria-label={t("panel.labelPreview")}
          className="overflow-x-auto rounded-xl border bg-muted/40 p-3 [--scale:1.15] focus-visible:outline-2 focus-visible:outline-ring min-[420px]:[--scale:1.5]"
        >
          <div style={{ width: `calc(${DEFAULT_LABEL_SIZE.widthMm}mm * var(--scale))`, height: `calc(${DEFAULT_LABEL_SIZE.heightMm}mm * var(--scale))` }}>
            <div style={{ transform: "scale(var(--scale))", transformOrigin: "top left" }}>
              <Label item={item} format={LABEL_FORMAT} className="shadow-sm" />
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-10 flex-1 gap-2" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          {t("panel.editItem")}
        </Button>
        <Link
          href={`/labels/print?sku=${encodeURIComponent(item.sku)}`}
          className={cn(buttonVariants(), "h-10 flex-1 gap-2")}
        >
          <Printer className="size-4" />
          {t("panel.printLabel")}
        </Link>
        <Button type="button" variant="outline" className="h-10 flex-1 gap-2" onClick={() => setReceiveOpen(true)}>
          <PackagePlus className="size-4" />
          {t("panel.receiveStock")}
        </Button>
      </div>

      <EditItemDialog open={editOpen} onOpenChange={setEditOpen} item={item} />
      {/* In place: receiving here keeps you on the catalog, so you can move straight on to the next item. */}
      <QuickReceiveDialog open={receiveOpen} onOpenChange={setReceiveOpen} items={[item]} />
    </div>
  );
}
