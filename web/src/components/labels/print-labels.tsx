"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useItems } from "@/hooks/use-items";
import { CUT_LINE_MM, DEFAULT_LABEL_SIZE, LABEL_FORMAT, LABEL_SIZES, labelsPerSheet, SHEET_MARGIN_MM } from "@/lib/label";
import { cn } from "@/lib/utils";
import { Label } from "./label";

const MAX_COPIES = 99;
// Every label is a live SVG barcode in the page, so past this the browser struggles long before
// the printer does.
const MAX_LABELS = 1500;

// Whatever was typed, as a whole number of copies in range. Blank counts as 0 (skip the item).
function toCopies(value: string): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_COPIES) : 0;
}

export function PrintLabels({ skus }: { skus: string[] }) {
  const t = useTranslations("labels");
  const tc = useTranslations("common");
  const items = useItems();
  const [sizeId, setSizeId] = useState(DEFAULT_LABEL_SIZE.id);
  // One number for every item, plus the items that were given their own. Changing the number
  // for all starts over, so it always does what it says.
  const [allCopies, setAllCopies] = useState(1);
  const [ownCopies, setOwnCopies] = useState<Record<string, number>>({});

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? DEFAULT_LABEL_SIZE;
  const wanted = useMemo(() => new Set(skus), [skus]);
  const found = useMemo(() => (items.data ?? []).filter((i) => wanted.has(i.sku)), [items.data, wanted]);
  const missing = items.isSuccess ? skus.length - found.length : 0;

  const rows = useMemo(
    () => found.map((item) => ({ item, copies: ownCopies[item.sku] ?? allCopies })),
    [found, ownCopies, allCopies],
  );
  const labelCount = rows.reduce((sum, row) => sum + row.copies, 0);
  const tooMany = labelCount > MAX_LABELS;
  const labels = useMemo(
    () =>
      tooMany ? [] : rows.flatMap(({ item, copies }) => Array.from({ length: copies }, (_, n) => ({ item, key: `${item.sku}-${n}` }))),
    [rows, tooMany],
  );
  const perSheet = labelsPerSheet(size);

  return (
    <div className="flex flex-col gap-6">
      {/* @page is the only way to control the printed page's margins. */}
      <style>{`@media print { @page { margin: ${SHEET_MARGIN_MM}mm } }`}</style>

      <div className="flex flex-col gap-4 print:hidden">
        <Link href="/catalog" className={cn(buttonVariants({ variant: "ghost" }), "-ml-3 h-9 w-fit gap-2")}>
          <ArrowLeft className="size-4" />
          {t("backToCatalog")}
        </Link>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {items.isPending
              ? tc("status.loading")
              : t("summary", { labelCount, itemCount: found.length, width: size.widthMm, height: size.heightMm })}
            {items.isSuccess && labelCount > 0 && ` ${t("sheetEstimate", { perPage: perSheet, pages: Math.ceil(labelCount / perSheet) })}`}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-4 rounded-2xl border bg-card p-4">
          <FormField id="size" label={t("size")} hint={t("sizeHint")}>
            <NativeSelect id="size" value={sizeId} onChange={(event) => setSizeId(event.target.value as typeof sizeId)} className="w-56">
              {LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {t("sizeOption", { name: t(`sizes.${s.id}`), width: s.widthMm, height: s.heightMm })}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField id="copies" label={t("copies")} hint={t("copiesHint")}>
            <Input
              id="copies"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_COPIES}
              value={allCopies}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                setAllCopies(toCopies(event.target.value));
                setOwnCopies({});
              }}
              aria-describedby="copies-msg"
              className="h-9 w-28 tabular-nums"
            />
          </FormField>

          <Button type="button" className="mt-7 h-11 gap-2" disabled={labels.length === 0} onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("print")}
          </Button>
        </div>

        {tooMany && (
          <p role="alert" className="text-sm text-destructive">
            {t("tooMany", { count: labelCount, max: MAX_LABELS })}
          </p>
        )}

        {missing > 0 && (
          <p role="status" className="text-sm text-warning">
            {t("missing", { count: missing })}
          </p>
        )}
        {items.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("loadError", { message: items.error.message })}
          </p>
        )}

        {rows.length > 0 && (
          <section aria-labelledby="per-item" className="flex flex-col gap-2">
            <h2 id="per-item" className="text-sm font-medium">
              {t("perItem")}
            </h2>
            <ul className="divide-y rounded-2xl border bg-card">
              {rows.map(({ item, copies }) => (
                <li key={item.sku} className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{item.barcode}</div>
                  </div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_COPIES}
                    value={copies}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setOwnCopies((current) => ({ ...current, [item.sku]: toCopies(event.target.value) }))}
                    aria-label={t("copiesFor", { name: item.name })}
                    className="h-9 w-20 shrink-0 text-center tabular-nums"
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Cut lines: every label carries a dashed border, and each cell is pulled over its
          neighbour by the border's width, so two labels share one line instead of showing two. */}
      <div className="label-grid flex flex-wrap" role="list" aria-label={t("labelsList")}>
        {labels.map(({ item, key }) => (
          <div
            key={key}
            role="listitem"
            className="label-cell break-inside-avoid"
            style={{ marginRight: `-${CUT_LINE_MM}mm`, marginBottom: `-${CUT_LINE_MM}mm` }}
          >
            <Label item={item} format={LABEL_FORMAT} size={size} className="border-dashed border-neutral-500" style={{ borderWidth: `${CUT_LINE_MM}mm` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
