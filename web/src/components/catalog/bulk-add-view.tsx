"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Download, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCategoryTree } from "@/hooks/use-items";
import { buildCategoryTree, leafOptions } from "@/lib/categories";
import type { Category } from "@/lib/types";
import { ApiError, apiFetch } from "@/lib/api";
import { downloadCsv, parseCsvAsObjects, toCsv } from "@/lib/csv";
import type { ReceiveResult } from "@/lib/types";
import { cn } from "@/lib/utils";

// Mirrors NewItemForm's rules exactly (see that file) — small enough, and specific enough to this
// screen's own error copy, that a shared module would cost more than it saves. Each endpoint file
// in the backend already owns its own validation the same way; see docs/TECH_DEBT.md.
const PRICE_RE = /^\d{1,7}(\.\d{1,2})?$/;
const QUANTITY_RE = /^\d+$/;
const BARCODE_RE = /^[A-Za-z0-9._-]{0,64}$/;

interface Row {
  id: string;
  name: string;
  price: string;
  quantity: string;
  categoryId: string;
  /** Set when this row came from a CSV category name that didn't match any existing category. */
  unmatchedCategory: string | null;
  barcode: string;
  status: "idle" | "saving" | "done" | "error";
  message: string | null;
  createdSku: string | null;
}

let nextId = 0;
const blankRow = (): Row => ({
  id: `r${++nextId}`,
  name: "",
  price: "",
  quantity: "1",
  categoryId: "",
  unmatchedCategory: null,
  barcode: "",
  status: "idle",
  message: null,
  createdSku: null,
});

// A row counts if it has a name — an untouched blank row (the common case: you added 5 rows, only
// filled in 3) is silently skipped rather than blocking submit with "row 4 is invalid".
const isFilled = (row: Row) => row.name.trim() !== "";

type CatalogT = ReturnType<typeof useTranslations<"catalog">>;

function fieldError(row: Row, t: CatalogT): string | null {
  if (!PRICE_RE.test(row.price.trim()) || !(Number(row.price) > 0)) return t("bulk.invalidPrice");
  const q = row.quantity.trim();
  if (!QUANTITY_RE.test(q) || Number(q) < 1 || Number(q) > 99_999) return t("bulk.invalidQuantity");
  if (!BARCODE_RE.test(row.barcode.trim())) return t("bulk.invalidBarcode");
  if (row.name.trim().length > 200) return t("bulk.nameTooLong");
  return null;
}

export function BulkAddView() {
  const formId = useId();
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const tree = useCategoryTree();
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const categoryOptions = useMemo(
    () => [{ value: "", label: t("fields.noCategory") }, ...leafOptions(tree)],
    [tree, t],
  );

  function update(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  async function onCsvChosen(file: File) {
    setCsvError(null);
    setImporting(true);
    try {
      // Fetches (or waits out an in-flight fetch for) the query's actual data, rather than
      // trusting categories.data/isPending as captured in this closure — those reflect whatever
      // render this handler was created on, which can be a beat stale of the real state. Matching
      // a CSV's category names against a stale "still loading" snapshot would silently match
      // nothing, even for categories that exist; this guarantees fresh data no matter how soon
      // after mount the file was chosen.
      const list = await queryClient.ensureQueryData({
        queryKey: ["categories"],
        queryFn: () => apiFetch<Category[]>("gateway", "categories"),
      });
      // Only categories with no sub-categories can hold items, so only those match — by their
      // own name (names are unique) or by the full "Jewelry › Earrings" path.
      const fresh = buildCategoryTree(list);
      const categoryByName = new Map(
        fresh.leaves.flatMap((c) => [
          [c.name.trim().toLowerCase(), c.id],
          [fresh.pathLabel(c.id).toLowerCase(), c.id],
        ]),
      );

      const text = await file.text();
      const parsed = parseCsvAsObjects(text);
      if (parsed.length === 0) {
        setCsvError(t("bulk.noRows"));
        return;
      }
      const missing = ["name", "price"].filter((k) => !(k in parsed[0]));
      if (missing.length > 0) {
        setCsvError(t("bulk.missingColumns", { columns: missing.join(", ") }));
        return;
      }
      const imported = parsed.map((cells): Row => {
        const categoryText = (cells.category ?? "").trim();
        const matchedId = categoryText ? categoryByName.get(categoryText.toLowerCase()) : undefined;
        return {
          ...blankRow(),
          name: cells.name ?? "",
          price: cells.price ?? "",
          quantity: (cells.quantity ?? "1").trim() || "1",
          barcode: cells.barcode ?? "",
          categoryId: matchedId ?? "",
          unmatchedCategory: categoryText && !matchedId ? categoryText : null,
        };
      });
      // Replace rather than append: uploading a file is "this is my list," not "add to what's here" —
      // appending to 3 untouched blank rows would just leave silent empties mixed in.
      setRows(imported);
    } catch {
      setCsvError(t("bulk.readFailed"));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function downloadTemplate() {
    downloadCsv("items-template.csv", toCsv(["name", "price", "quantity", "category", "barcode"], []));
  }

  const create = useMutation({
    mutationFn: (row: Row) =>
      apiFetch<ReceiveResult>("gateway", "items/intake", {
        method: "POST",
        body: JSON.stringify({
          name: row.name.trim(),
          price: Number(row.price),
          quantity: Number(row.quantity),
          categoryId: row.categoryId || null,
          imageUrl: null,
          barcode: row.barcode.trim() || null,
        }),
      }),
  });

  const filled = rows.filter(isFilled);
  const pending = filled.filter((r) => r.status !== "done");
  const invalid = pending.some((r) => fieldError(r, t) !== null);
  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  async function submit() {
    setBusy(true);
    for (const row of pending) {
      const err = fieldError(row, t);
      if (err) continue; // shouldn't happen — submit is disabled while any row is invalid
      update(row.id, { status: "saving", message: null });
      try {
        const result = await create.mutateAsync(row);
        update(row.id, { status: "done", message: null, createdSku: result.sku });
      } catch (error) {
        const message =
          error instanceof ApiError && error.status === 409
            ? t("bulk.barcodeTaken")
            : error instanceof Error
              ? error.message
              : t("bulk.createFailed");
        update(row.id, { status: "error", message });
      }
    }
    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ["items"] });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("bulk.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("bulk.description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label={t("bulk.uploadCsvAria")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onCsvChosen(file);
          }}
        />
        <Button type="button" variant="outline" className="h-10 gap-2" disabled={importing} onClick={() => fileInput.current?.click()}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t("bulk.uploadCsv")}
        </Button>
        <Button type="button" variant="ghost" className="h-10 gap-2 text-muted-foreground" onClick={downloadTemplate}>
          <Download className="size-4" />
          {t("bulk.downloadTemplate")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("bulk.columnsHelp")}</span>
      </div>
      {csvError && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {csvError}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const err = isFilled(row) ? fieldError(row, t) : null;
          // Positional, not row.id: row.id comes from a module-level counter that isn't reset
          // between server and client, so using it in a DOM id (unlike a React `key`, which never
          // touches the DOM) caused a real hydration mismatch here.
          const rowId = `${formId}-${index}`;
          return (
            <li
              key={row.id}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-card p-3",
                row.status === "done" && "border-success/40 bg-success/5",
                row.status === "error" && "border-destructive/40",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <label htmlFor={`${rowId}-name`} className="sr-only">
                  {t("fields.name")}
                </label>
                <Input
                  id={`${rowId}-name`}
                  placeholder={t("bulk.itemName")}
                  autoComplete="off"
                  value={row.name}
                  disabled={row.status === "done" || busy}
                  onChange={(e) => update(row.id, { name: e.target.value })}
                  className="h-10 flex-1"
                />
                {row.status === "done" ? (
                  <span className="flex shrink-0 items-center gap-1.5 px-2 text-sm text-success">
                    <Check className="size-4" /> {t("bulk.created")}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground"
                    aria-label={t("bulk.removeRow", { n: index + 1 })}
                    disabled={busy}
                    onClick={() => removeRow(row.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>

              {row.status !== "done" && (
                <div className="grid grid-cols-2 gap-2 pl-7 sm:grid-cols-4">
                  <label htmlFor={`${rowId}-price`} className="sr-only">
                    {t("fields.price")}
                  </label>
                  <Input
                    id={`${rowId}-price`}
                    inputMode="decimal"
                    placeholder={t("fields.price")}
                    autoComplete="off"
                    value={row.price}
                    disabled={busy}
                    onChange={(e) => update(row.id, { price: e.target.value })}
                    className="h-10"
                  />
                  <label htmlFor={`${rowId}-qty`} className="sr-only">
                    {t("bulk.startingQuantity")}
                  </label>
                  <Input
                    id={`${rowId}-qty`}
                    inputMode="numeric"
                    placeholder={t("bulk.qty")}
                    autoComplete="off"
                    value={row.quantity}
                    disabled={busy}
                    onChange={(e) => update(row.id, { quantity: e.target.value.replace(/[^\d]/g, "") })}
                    className="h-10"
                  />
                  <Combobox
                    aria-label={row.name ? t("bulk.categoryForNamed", { name: row.name }) : t("bulk.categoryForRow", { n: index + 1 })}
                    value={row.categoryId}
                    onValueChange={(v) => update(row.id, { categoryId: v, unmatchedCategory: null })}
                    options={categoryOptions}
                    disabled={busy}
                    className="col-span-2 sm:col-span-1"
                  />
                  <label htmlFor={`${rowId}-barcode`} className="sr-only">
                    {t("fields.barcode")}
                  </label>
                  <Input
                    id={`${rowId}-barcode`}
                    placeholder={t("bulk.barcodeOptional")}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={row.barcode}
                    disabled={busy}
                    onChange={(e) => update(row.id, { barcode: e.target.value })}
                    className="col-span-2 h-10 font-mono sm:col-span-1"
                  />
                </div>
              )}

              {row.unmatchedCategory && row.status !== "done" && (
                <p className="flex items-center gap-1.5 pl-7 text-xs text-warning">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {t("bulk.unmatchedCategory", { name: row.unmatchedCategory })}
                </p>
              )}
              {err && (
                <p role="alert" className="pl-7 text-xs text-destructive">
                  {err}
                </p>
              )}
              {row.status === "error" && row.message && (
                <p role="alert" className="flex items-center gap-1.5 pl-7 text-xs text-destructive">
                  <X className="size-3.5 shrink-0" /> {row.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Button type="button" variant="outline" className="h-10 w-fit gap-2" disabled={busy} onClick={() => setRows((rs) => [...rs, blankRow()])}>
        <Plus className="size-4" />
        {t("bulk.addRow")}
      </Button>

      {(doneCount > 0 || errorCount > 0) && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {doneCount > 0 && t("bulk.createdCount", { count: doneCount })}
          {doneCount > 0 && errorCount > 0 && " · "}
          {errorCount > 0 && t("bulk.failedCount", { count: errorCount })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="h-11 px-6" disabled={busy || invalid || filled.length === 0} onClick={() => void submit()}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {errorCount > 0 ? t("bulk.retry", { count: pending.length }) : t("bulk.create", { count: filled.length })}
        </Button>
        <Link href="/catalog" className={cn(buttonVariants({ variant: "ghost" }), "h-11")}>
          {doneCount > 0 && errorCount === 0 && pending.length === 0 ? t("bulk.done") : tc("actions.cancel")}
        </Link>
      </div>
    </div>
  );
}
