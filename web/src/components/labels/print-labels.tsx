"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useItems } from "@/hooks/use-items";
import { LABEL_FORMAT, LABEL_HEIGHT_IN, LABEL_WIDTH_IN } from "@/lib/label";
import { cn } from "@/lib/utils";
import { Label } from "./label";

type Layout = "sheet" | "roll";

export function PrintLabels({ skus }: { skus: string[] }) {
  const t = useTranslations("labels");
  const tc = useTranslations("common");
  const items = useItems();
  const [copies, setCopies] = useState(1);
  const [layout, setLayout] = useState<Layout>("sheet");

  const wanted = useMemo(() => new Set(skus), [skus]);
  const found = useMemo(() => (items.data ?? []).filter((i) => wanted.has(i.sku)), [items.data, wanted]);
  const missing = items.isSuccess ? skus.length - found.length : 0;
  const labels = useMemo(() => found.flatMap((item) => Array.from({ length: copies }, (_, n) => ({ item, key: `${item.sku}-${n}` }))), [found, copies]);

  return (
    <div className="flex flex-col gap-6">
      {/* @page is the only way to control the printed page size. Roll mode makes each label its
          own page at label size (for a thermal printer); sheet mode leaves normal paper and packs
          labels onto it. */}
      <style>
        {layout === "roll"
          ? `@media print { @page { size: ${LABEL_WIDTH_IN}in ${LABEL_HEIGHT_IN}in; margin: 0 } .label-cell { break-after: page; } .label-cell:last-child { break-after: auto; } .label-grid { gap: 0 !important; } }`
          : `@media print { @page { margin: 10mm } }`}
      </style>

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
              : t("summary", { labelCount: labels.length, itemCount: found.length, width: LABEL_WIDTH_IN, height: LABEL_HEIGHT_IN })}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-2xl border bg-card p-4">
          <FormField id="copies" label={t("copies")}>
            <NativeSelect id="copies" value={copies} onChange={(event) => setCopies(Number(event.target.value))} className="w-28">
              {[1, 2, 3, 4, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="layout" label={t("paper")} hint={t("paperHint")}>
            <NativeSelect id="layout" value={layout} onChange={(event) => setLayout(event.target.value as Layout)} className="w-56">
              <option value="sheet">{t("sheet")}</option>
              <option value="roll">{t("roll")}</option>
            </NativeSelect>
          </FormField>
          <Button type="button" className="h-11 gap-2" disabled={labels.length === 0} onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("print")}
          </Button>
        </div>

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
      </div>

      <div className="label-grid flex flex-wrap gap-[0.1in]" role="list" aria-label={t("labelsList")}>
        {labels.map(({ item, key }) => (
          <div key={key} role="listitem" className="label-cell break-inside-avoid">
            <Label item={item} format={LABEL_FORMAT} className="border border-dashed border-neutral-300 print:border-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
