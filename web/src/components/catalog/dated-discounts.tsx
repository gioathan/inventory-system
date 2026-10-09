"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField } from "@/components/form-field";
import { NoticeBanner } from "@/components/notice-banner";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDatedDiscounts } from "@/hooks/use-admin-data";
import type { Notice } from "@/hooks/use-item-lookup";
import { useCategoryTree, useItems } from "@/hooks/use-items";
import { apiFetch } from "@/lib/api";
import { countItems } from "@/lib/categories";
import { isoDateToDate, stageOf, type DatedDiscountStage } from "@/lib/dated-discounts";
import { formatPercent } from "@/lib/format";
import type { CatalogEntry, DatedDiscount, DatedDiscountPeriod } from "@/lib/types";

// "20 Oct 2026" or "24 – 26 Dec 2026", in the UI language.
export function useDateRangeLabel() {
  const format = useFormatter();
  const one = (iso: string) => format.dateTime(isoDateToDate(iso), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (start: string, end: string) => (start === end ? one(start) : format.dateTimeRange(isoDateToDate(start), isoDateToDate(end), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
}

const STAGES: DatedDiscountStage[] = ["active", "soon", "later"];

// The dated half of the Discounts screen: what's running today, what's coming up and worth a
// look before it starts, and everything further off. `prefillSkus` opens the "new" form with
// those items already chosen (the Catalog's selection bar links here with them).
export function DatedDiscountsSection({ prefillSkus }: { prefillSkus?: string[] }) {
  const t = useTranslations("discounts.dated");
  const queryClient = useQueryClient();
  const discounts = useDatedDiscounts();
  const rangeLabel = useDateRangeLabel();
  const [editing, setEditing] = useState<DatedDiscount | "new" | null>(prefillSkus && prefillSkus.length > 0 ? "new" : null);
  const [deleting, setDeleting] = useState<DatedDiscount | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["dated-discounts"] });
    // A dated discount that is running today changes the price items show right now.
    queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  const skip = useMutation({
    mutationFn: ({ discount, skip: on }: { discount: DatedDiscount; skip: boolean }) =>
      apiFetch<DatedDiscount>("gateway", `dated-discounts/${discount.id}/skip`, { method: "POST", body: JSON.stringify({ skip: on }) }),
    onSuccess: (updated, { skip: on }) => {
      refresh();
      setNotice({ kind: "success", text: on ? t("skipped", { name: updated.name, year: updated.skippedYear ?? "" }) : t("unskipped", { name: updated.name }) });
    },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : t("saveFailed") }),
  });

  const remove = useMutation({
    mutationFn: (discount: DatedDiscount) => apiFetch<void>("gateway", `dated-discounts/${discount.id}`, { method: "DELETE" }),
    onSuccess: (_, discount) => {
      refresh();
      setDeleting(null);
      setNotice({ kind: "success", text: t("deleted", { name: discount.name }) });
    },
  });

  const all = discounts.data ?? [];

  return (
    <section aria-labelledby="dated-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="dated-heading" className="text-lg font-semibold tracking-tight">
            {t("title")}
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button type="button" className="h-10 gap-2" onClick={() => setEditing("new")}>
          <CalendarPlus className="size-4" />
          {t("new")}
        </Button>
      </div>

      {notice && <NoticeBanner notice={notice} />}

      {discounts.isPending ? (
        <div className="h-24 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loading")} />
      ) : discounts.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("loadError", { message: discounts.error.message })}
        </p>
      ) : all.length === 0 ? (
        <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <CalendarClock className="size-6 text-primary/70" />
          {t("empty")}
        </div>
      ) : (
        STAGES.map((stage) => {
          const inStage = all.filter((d) => stageOf(d) === stage);
          if (inStage.length === 0) return null;
          return (
            <div key={stage} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">{t(`stages.${stage}`, { count: inStage.length })}</h3>
              <ul className="flex flex-col gap-2">
                {inStage.map((discount) => (
                  <li key={discount.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{discount.name}</span>
                        <StatusPill tone="warning" className="px-2 py-0.5">
                          {t("percentOff", { percent: formatPercent(discount.percentage) })}
                        </StatusPill>
                        {stage === "active" && <StatusPill tone="success" className="px-2 py-0.5">{t("runningToday")}</StatusPill>}
                        {stage === "soon" && (
                          <StatusPill tone="info" className="px-2 py-0.5">{t("startsIn", { count: discount.daysUntilNext ?? 0 })}</StatusPill>
                        )}
                        {discount.skippedYear !== null && (
                          <StatusPill tone="neutral" className="px-2 py-0.5">{t("skippedPill", { year: discount.skippedYear })}</StatusPill>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("itemCount", { count: discount.skus.length })}
                        {discount.nextStart && discount.nextEnd && (
                          <>
                            {" · "}
                            {stage === "active"
                              ? t("until", { date: rangeLabel(discount.nextEnd, discount.nextEnd) })
                              : t("next", { dates: rangeLabel(discount.nextStart, discount.nextEnd) })}
                          </>
                        )}
                        {discount.lastStart && discount.lastEnd && (
                          <>
                            {" · "}
                            {t("last", { dates: rangeLabel(discount.lastStart, discount.lastEnd) })}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" variant="outline" className="h-9 gap-2" onClick={() => setEditing(discount)}>
                        <Pencil className="size-4" />
                        {t("edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        disabled={skip.isPending}
                        onClick={() => skip.mutate({ discount, skip: discount.skippedYear === null })}
                      >
                        {discount.skippedYear !== null
                          ? t("undoSkip")
                          : t("skip", { year: discount.nextStart ? discount.nextStart.slice(0, 4) : "" })}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("deleteNamed", { name: discount.name })}
                        className="size-9 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          remove.reset();
                          setDeleting(discount);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      {editing !== null && (
        <DatedDiscountDialog
          key={editing === "new" ? "new" : editing.id}
          discount={editing === "new" ? null : editing}
          prefillSkus={editing === "new" ? prefillSkus : undefined}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            refresh();
            setEditing(null);
            setNotice({ kind: "success", text: t("saved", { name: saved.name }) });
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteDescription")}
        confirmLabel={t("deleteConfirm")}
        destructive
        pending={remove.isPending}
        error={remove.isError ? (remove.error instanceof Error ? remove.error.message : t("deleteFailed")) : null}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </section>
  );
}

interface PeriodDraft {
  key: number;
  startDate: string;
  endDate: string;
}

function DatedDiscountDialog({
  discount,
  prefillSkus,
  onClose,
  onSaved,
}: {
  discount: DatedDiscount | null;
  prefillSkus?: string[];
  onClose: () => void;
  onSaved: (saved: DatedDiscount) => void;
}) {
  const t = useTranslations("discounts.dated");
  const items = useItems();
  const tree = useCategoryTree();

  const [name, setName] = useState(discount?.name ?? "");
  const [percent, setPercent] = useState(discount ? String(Math.round(discount.percentage * 10000) / 100) : "");
  const [periods, setPeriods] = useState<PeriodDraft[]>(() =>
    discount ? discount.periods.map((p, key) => ({ key, ...p })) : [{ key: 0, startDate: "", endDate: "" }],
  );
  const [skus, setSkus] = useState<string[]>(() => discount?.skus ?? prefillSkus ?? []);
  const [category, setCategory] = useState("");

  const all = items.data ?? [];
  const bySku = new Map(all.map((i) => [i.sku, i]));
  const chosen = skus.map((sku) => bySku.get(sku) ?? ({ sku, name: sku } as Pick<CatalogEntry, "sku" | "name">));
  const counts = countItems(tree, all);

  const add = (more: string[]) => setSkus((current) => [...current, ...more.filter((sku) => !current.includes(sku))]);
  const addCategory = () => {
    if (!category) return;
    const within = tree.withDescendants(category);
    add(all.filter((i) => i.categoryId !== null && within.has(i.categoryId)).map((i) => i.sku));
    setCategory("");
  };

  const fraction = Number(percent.replace(",", ".")) / 100;
  const percentValid = Number.isFinite(fraction) && fraction > 0 && fraction < 1;
  // A period with no end date is a single day.
  const cleaned: DatedDiscountPeriod[] = periods.filter((p) => p.startDate).map((p) => ({ startDate: p.startDate, endDate: p.endDate || p.startDate }));
  const datesValid = cleaned.length > 0 && cleaned.length === periods.length && cleaned.every((p) => p.endDate >= p.startDate);
  const valid = name.trim().length > 0 && percentValid && datesValid && skus.length > 0;

  const save = useMutation({
    mutationFn: () =>
      apiFetch<DatedDiscount>("gateway", discount ? `dated-discounts/${discount.id}` : "dated-discounts", {
        method: discount ? "PUT" : "POST",
        body: JSON.stringify({ name: name.trim(), percentage: fraction, periods: cleaned, skus }),
      }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{discount ? t("form.editTitle", { name: discount.name }) : t("form.newTitle")}</DialogTitle>
            <DialogDescription>{t("form.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <FormField id="dated-name" label={t("form.name")} hint={t("form.nameHint")}>
              <Input id="dated-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="off" aria-describedby="dated-name-msg" className="h-11" />
            </FormField>
            <FormField id="dated-percent" label={t("form.percent")} error={percent !== "" && !percentValid ? t("form.percentError") : undefined}>
              <Input
                id="dated-percent"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={percent !== "" && !percentValid}
                aria-describedby="dated-percent-msg"
                className="h-11"
              />
            </FormField>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("form.dates")}</legend>
            {periods.map((period, index) => (
              <div key={period.key} className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  aria-label={t("form.startOf", { n: index + 1 })}
                  value={period.startDate}
                  onChange={(event) => setPeriods((current) => current.map((p) => (p.key === period.key ? { ...p, startDate: event.target.value } : p)))}
                  className="h-11 w-auto flex-1"
                />
                <span className="text-sm text-muted-foreground">{t("form.to")}</span>
                <Input
                  type="date"
                  aria-label={t("form.endOf", { n: index + 1 })}
                  value={period.endDate}
                  min={period.startDate || undefined}
                  onChange={(event) => setPeriods((current) => current.map((p) => (p.key === period.key ? { ...p, endDate: event.target.value } : p)))}
                  className="h-11 w-auto flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("form.removeDates", { n: index + 1 })}
                  className="size-9 text-muted-foreground"
                  disabled={periods.length === 1}
                  onClick={() => setPeriods((current) => current.filter((p) => p.key !== period.key))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("form.datesHint")}</p>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2"
                onClick={() => setPeriods((current) => [...current, { key: Math.max(...current.map((p) => p.key)) + 1, startDate: "", endDate: "" }])}
              >
                <Plus className="size-4" />
                {t("form.addDates")}
              </Button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t("form.items", { count: skus.length })}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <FormField id="dated-category" label={t("form.addCategory")} className="min-w-48 flex-1">
                <Combobox
                  id="dated-category"
                  value={category}
                  onValueChange={setCategory}
                  options={tree.nested.map(({ category: c }) => ({ value: c.id, label: `${tree.pathLabel(c.id)} (${counts.total(c.id)})` }))}
                />
              </FormField>
              <Button type="button" variant="outline" className="h-11" disabled={!category} onClick={addCategory}>
                {t("form.add")}
              </Button>
            </div>
            <FormField id="dated-item" label={t("form.addItem")}>
              <Combobox
                id="dated-item"
                value=""
                onValueChange={(sku) => sku && add([sku])}
                disabled={items.isPending}
                options={all.filter((i) => !skus.includes(i.sku)).map((i) => ({ value: i.sku, label: `${i.name} · ${i.sku}` }))}
              />
            </FormField>
            {chosen.length > 0 && (
              <ul aria-label={t("form.chosen")} className="max-h-48 divide-y overflow-y-auto rounded-xl border" tabIndex={0}>
                {chosen.map((item) => (
                  <li key={item.sku} className="flex items-center gap-2 py-1 pl-3 pr-1">
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("form.removeItem", { name: item.name })}
                      className="size-8 text-muted-foreground"
                      onClick={() => setSkus((current) => current.filter((sku) => sku !== item.sku))}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {save.isError && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {save.error instanceof Error ? save.error.message : t("saveFailed")}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" disabled={save.isPending} onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" className="h-10 gap-2" disabled={!valid || save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
