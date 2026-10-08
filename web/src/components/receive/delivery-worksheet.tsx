"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Camera, ClipboardPaste, Loader2, Minus, PackageOpen, Plus, Search, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ItemImage } from "@/components/item-image";
import { NoticeBanner } from "@/components/notice-banner";
import { SessionBanner } from "@/components/restock/session-banner";
import { CameraScanner } from "@/components/scan/camera-scanner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Notice } from "@/hooks/use-item-lookup";
import { useItems } from "@/hooks/use-items";
import { useKeyboardWedge } from "@/hooks/use-keyboard-wedge";
import { ApiError, apiFetch } from "@/lib/api";
import { parseDeliveryList } from "@/lib/delivery";
import { matchesSearch } from "@/lib/item-filters";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DeliveryImportDialog } from "./delivery-import-dialog";
import { MAX_RECEIVE_QUANTITY } from "./receive-card";

interface Line {
  sku: string;
  /** Kept as typed, so a half-edited or empty box isn't silently turned into a number. */
  quantity: string;
  error?: string;
}

/** A row from a pasted list whose barcode/SKU isn't in the catalog. Null quantity: the list's own was unreadable. */
interface Unmatched {
  id: string;
  code: string;
  quantity: number | null;
}

interface ReceivedLine {
  sku: string;
  name: string;
  quantity: number;
  total: number;
}

interface BatchReceiveResponse {
  results: { sku: string; status: "received" | "notFound" | "invalid" | "failed"; quantityOnHand: number | null; error: string | null }[];
}

// The list survives a refresh or a closed tab: a delivery of 80 lines is too much typing to lose,
// and nothing on it has touched stock until "Receive all". Browser-scoped, like the theme.
const DRAFT_KEY = "apex.delivery-draft.v1";
// The backend caps a batch at 500 lines; smaller chunks also keep each request comfortably short.
const CHUNK_SIZE = 200;
const MAX_SUGGESTIONS = 8;
// Same signature a hardware scanner has everywhere else in the app (see use-keyboard-wedge).
const SCAN_GAP_MS = 80;
const SCAN_MIN_LENGTH = 6;

function readDraft(): { lines: Line[]; unmatched: Unmatched[] } {
  const empty = { lines: [], unmatched: [] };
  if (typeof window === "undefined") return empty;
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null");
    if (!draft || !Array.isArray(draft.lines) || !Array.isArray(draft.unmatched)) return empty;
    return {
      lines: draft.lines.filter((l: Line) => typeof l?.sku === "string" && typeof l?.quantity === "string"),
      unmatched: draft.unmatched.filter((u: Unmatched) => typeof u?.id === "string" && typeof u?.code === "string"),
    };
  } catch {
    return empty; // private window, blocked storage, or a draft written by some other version
  }
}

const parseQuantity = (text: string) => (/^\d+$/.test(text) ? Number(text) : NaN);
const isValidQuantity = (text: string) => {
  const n = parseQuantity(text);
  return n >= 1 && n <= MAX_RECEIVE_QUANTITY;
};

interface RowActions {
  setQuantity: (sku: string, quantity: string) => void;
  remove: (sku: string) => void;
  scan: (code: string) => void;
  focusAddBox: () => void;
  register: (sku: string, element: HTMLInputElement | null) => void;
}

const DeliveryRow = memo(function DeliveryRow({
  line,
  item,
  flash,
  busy,
  actions,
}: {
  line: Line;
  item: CatalogEntry;
  flash: boolean;
  busy: boolean;
  actions: RowActions;
}) {
  const t = useTranslations("receive.delivery.list");
  const td = useTranslations("receive.dialog");
  const burst = useRef({ text: "", last: 0, before: "" });
  const valid = isValidQuantity(line.quantity);
  const onHand = item.quantityOnHand ?? 0;

  function step(delta: number) {
    const current = valid ? Number(line.quantity) : 0;
    actions.setQuantity(line.sku, String(Math.min(Math.max(current + delta, 1), MAX_RECEIVE_QUANTITY)));
  }

  // The one place a scan could do damage: with the cursor in a quantity box, a scanner would type
  // its 12 digits in as the quantity. A burst of fast keystrokes ending in Enter is a scan, not a
  // person, so put the quantity back and treat the digits as the next item instead.
  // event.timeStamp is when the key was pressed, not when this handler got to run, so a page busy
  // rendering can't stretch a scanner's few-millisecond gaps into something that looks human.
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const b = burst.current;
    if (event.timeStamp - b.last > SCAN_GAP_MS) {
      b.text = "";
      b.before = line.quantity;
    }
    b.last = event.timeStamp;
    if (event.key === "Enter") {
      event.preventDefault();
      if (b.text.length >= SCAN_MIN_LENGTH) {
        actions.setQuantity(line.sku, b.before);
        actions.scan(b.text);
      }
      b.text = "";
      actions.focusAddBox();
    } else if (event.key.length === 1) {
      b.text += event.key;
    }
  }

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-700 md:grid-cols-[minmax(0,1fr)_5rem_10.5rem_5rem_2.5rem]",
        flash && "bg-primary/10 duration-0",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ItemImage src={item.imageUrl} alt="" className="size-10 rounded-lg" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{item.sku}</div>
        </div>
      </div>
      <span className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">{onHand}</span>
      <div className="col-start-1 flex items-center gap-1 md:col-start-auto md:justify-center">
        <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" disabled={busy} aria-label={t("decrease", { name: item.name })} onClick={() => step(-1)}>
          <Minus className="size-4" />
        </Button>
        <Input
          ref={(element) => actions.register(line.sku, element)}
          inputMode="numeric"
          autoComplete="off"
          aria-label={t("quantityFor", { name: item.name })}
          aria-invalid={!valid}
          aria-describedby={!valid || line.error ? `delivery-msg-${line.sku}` : undefined}
          value={line.quantity}
          disabled={busy}
          onChange={(event) => actions.setQuantity(line.sku, event.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.target.select()}
          className="h-10 w-20 text-center tabular-nums"
        />
        <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" disabled={busy} aria-label={t("increase", { name: item.name })} onClick={() => step(1)}>
          <Plus className="size-4" />
        </Button>
        <span className="ml-2 text-xs tabular-nums text-muted-foreground md:hidden">
          {valid ? td("inStockAfter", { count: onHand, after: onHand + Number(line.quantity) }) : td("inStock", { count: onHand })}
        </span>
      </div>
      <span className="hidden text-right text-sm font-medium tabular-nums md:block">{valid ? onHand + Number(line.quantity) : "—"}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto"
        disabled={busy}
        aria-label={t("remove", { name: item.name })}
        onClick={() => actions.remove(line.sku)}
      >
        <X className="size-4" />
      </Button>
      {(!valid || line.error) && (
        <p id={`delivery-msg-${line.sku}`} role={line.error ? "alert" : undefined} className="col-span-full text-xs text-destructive">
          {!valid ? td("invalidQuantity", { max: MAX_RECEIVE_QUANTITY.toLocaleString() }) : line.error}
        </p>
      )}
    </li>
  );
});

// Receiving a whole delivery: one running list, filled by scanning, by searching, or by pasting
// the supplier's list, then added to stock in a single step. The one-at-a-time Receive screen
// posts each item immediately; this one deliberately doesn't, so the list can be checked against
// the delivery note before anything changes.
export function DeliveryWorksheet({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("receive.delivery");
  const queryClient = useQueryClient();
  const items = useItems();

  const [initial] = useState(readDraft);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [unmatched, setUnmatched] = useState<Unmatched[]>(initial.unmatched);
  const [received, setReceived] = useState<ReceivedLine[]>([]);
  const [notice, setNotice] = useState<Notice | null>(() => {
    const count = initial.lines.length + initial.unmatched.length;
    return count > 0 ? { kind: "success", text: t("draftRestored", { count }) } : null;
  });
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [resolving, setResolving] = useState<Unmatched | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const addInput = useRef<HTMLInputElement>(null);
  const quantityInputs = useRef(new Map<string, HTMLInputElement>());
  const focusQuantityOf = useRef<string | null>(null);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const index = useMemo(() => {
    const byBarcode = new Map<string, CatalogEntry>();
    const bySku = new Map<string, CatalogEntry>();
    const bySkuLower = new Map<string, CatalogEntry>();
    for (const item of all) {
      byBarcode.set(item.barcode, item);
      bySku.set(item.sku, item);
      bySkuLower.set(item.sku.toLowerCase(), item);
    }
    return { byBarcode, bySku, bySkuLower };
  }, [all]);
  const resolve = (code: string) => index.byBarcode.get(code) ?? index.bySku.get(code) ?? index.bySkuLower.get(code.toLowerCase());

  // An item deleted from the catalog since the draft was saved just drops off the list.
  const rows = useMemo(
    () => lines.flatMap((line) => (index.bySku.has(line.sku) ? [{ line, item: index.bySku.get(line.sku)! }] : [])),
    [lines, index],
  );
  const invalidCount = rows.filter(({ line }) => !isValidQuantity(line.quantity)).length;
  const failedCount = rows.filter(({ line }) => line.error).length;
  const totalUnits = rows.reduce((sum, { line }) => sum + (isValidQuantity(line.quantity) ? Number(line.quantity) : 0), 0);

  const suggestions = useMemo(() => {
    const term = query.trim();
    return term.length < 2 ? [] : all.filter((item) => matchesSearch(item, term)).slice(0, MAX_SUGGESTIONS);
  }, [all, query]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ lines: lines.map(({ sku, quantity }) => ({ sku, quantity })), unmatched }));
    } catch {
      // Storage unavailable: the list simply won't survive a refresh.
    }
  }, [lines, unmatched]);

  // After picking an item from search, the cursor lands in its quantity box with the number
  // selected, so typing "24" replaces the 1. Done after render, once that row exists.
  useEffect(() => {
    const sku = focusQuantityOf.current;
    if (!sku) return;
    focusQuantityOf.current = null;
    const input = quantityInputs.current.get(sku);
    input?.focus();
    input?.select();
  }, [lines]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // Focus the box on desktop so scanning just works; not on touch devices, where it would pop
  // the on-screen keyboard over the list.
  const ready = !!items.data;
  useEffect(() => {
    if (ready && window.matchMedia("(pointer: fine)").matches) addInput.current?.focus();
  }, [ready]);

  // "scan": one more of this item, and stay in the scan box for the next one.
  // "pick": chosen from search, so the quantity is still to be typed — go to its box.
  function addItem(item: CatalogEntry, mode: "scan" | "pick") {
    const existing = lines.find((line) => line.sku === item.sku);
    const current = existing && isValidQuantity(existing.quantity) ? Number(existing.quantity) : 0;
    // Resolving a row from a pasted list carries that row's quantity over to the item picked for it.
    const amount = resolving ? (resolving.quantity ?? 1) : existing && mode === "pick" ? 0 : 1;
    const quantity = String(Math.min(Math.max(current + amount, 1), MAX_RECEIVE_QUANTITY));

    setLines((previous) => [{ sku: item.sku, quantity }, ...previous.filter((line) => line.sku !== item.sku)]);
    if (resolving) {
      setUnmatched((previous) => previous.filter((row) => row.id !== resolving.id));
      setResolving(null);
    }
    setFlash(item.sku);
    setAnnouncement(t("add.onList", { name: item.name, quantity }));
    setNotice(null);
    setQuery("");
    setActive(0);
    if (mode === "pick" || resolving) focusQuantityOf.current = item.sku;
  }

  function addByCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const item = resolve(code);
    if (item) addItem(item, "scan");
    else setNotice({ kind: "error", text: t("add.noMatch", { code }) });
  }

  function submitAddBox() {
    const code = query.trim();
    if (!code) return;
    const exact = resolve(code);
    if (exact) return addItem(exact, "scan");
    const chosen = suggestions[active];
    if (chosen) return addItem(chosen, "pick");
    setNotice({ kind: "error", text: t("add.noMatch", { code }) });
    addInput.current?.select(); // so the next scan or keystroke replaces the code that didn't match
  }

  // A hardware scanner is a keyboard. With focus on a button or nowhere, the page-wide listener
  // catches the scan; inside the add box it's just typing followed by Enter.
  useKeyboardWedge(addByCode, ready && !busy);

  // Everything handed to a row is referentially stable, so typing in one quantity box re-renders
  // that row alone rather than the whole list — which is what keeps a 200-line delivery snappy.
  // addByCode closes over the current list, so rows reach it through a ref instead.
  const addByCodeRef = useRef(addByCode);
  useEffect(() => {
    addByCodeRef.current = addByCode;
  });
  const rowActions = useMemo<RowActions>(
    () => ({
      setQuantity: (sku, quantity) => setLines((previous) => previous.map((line) => (line.sku === sku ? { sku, quantity } : line))),
      remove: (sku) => setLines((previous) => previous.filter((line) => line.sku !== sku)),
      scan: (code) => addByCodeRef.current(code),
      focusAddBox: () => addInput.current?.focus(),
      register: (sku, element) => {
        if (element) quantityInputs.current.set(sku, element);
        else quantityInputs.current.delete(sku);
      },
    }),
    [],
  );

  function importList(text: string): boolean {
    const imported = parseDeliveryList(text);
    if (imported.length === 0) return false;

    const add = new Map<string, number>(); // NaN: the item matched but its quantity was unreadable
    const missing: Unmatched[] = [];
    for (const row of imported) {
      const item = resolve(row.code);
      if (item) add.set(item.sku, (add.get(item.sku) ?? 0) + row.quantity);
      else missing.push({ id: `${Date.now()}-${missing.length}`, code: row.code, quantity: Number.isNaN(row.quantity) ? null : row.quantity });
    }

    setLines((previous) => {
      const merged = [...add].map(([sku, amount]) => {
        const existing = previous.find((line) => line.sku === sku);
        const current = existing && isValidQuantity(existing.quantity) ? Number(existing.quantity) : 0;
        // An unreadable quantity becomes an empty box, flagged in the list, rather than a guess.
        return { sku, quantity: Number.isNaN(amount) ? (existing?.quantity ?? "") : String(Math.min(current + amount, MAX_RECEIVE_QUANTITY)) };
      });
      return [...merged, ...previous.filter((line) => !add.has(line.sku))];
    });
    setUnmatched((previous) => [...missing, ...previous]);
    setNotice(
      missing.length > 0
        ? { kind: "error", text: t("import.resultUnmatched", { matched: imported.length - missing.length, unmatched: missing.length }) }
        : { kind: "success", text: t("import.result", { matched: imported.length }) },
    );
    return true;
  }

  async function submit() {
    setBusy(true);
    setNotice(null);
    const sending = rows.map(({ line, item }) => ({ sku: line.sku, name: item.name, quantity: Number(line.quantity) }));
    const totals = new Map<string, number>();
    const errors = new Map<string, string>();

    for (let start = 0; start < sending.length; start += CHUNK_SIZE) {
      const chunk = sending.slice(start, start + CHUNK_SIZE);
      try {
        const { results } = await apiFetch<BatchReceiveResponse>("gateway", "receive/batch", {
          method: "POST",
          body: JSON.stringify({ lines: chunk.map(({ sku, quantity }) => ({ sku, quantity })) }),
        });
        results.forEach((result, i) => {
          const sku = chunk[i].sku;
          if (result.status === "received") totals.set(sku, result.quantityOnHand ?? 0);
          else errors.set(sku, result.status === "notFound" ? t("errors.notFound") : result.status === "invalid" ? t("errors.invalid") : result.error || t("errors.failed"));
        });
      } catch (error) {
        // A 4xx means the request was refused outright, so nothing in it was applied. Anything
        // else (timeout, dropped connection, 5xx) leaves it genuinely unknown, and saying
        // "failed, retry" there would invite adding the same stock twice.
        const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
        for (const { sku } of chunk) errors.set(sku, refused ? error.message : t("errors.unconfirmed"));
        break; // later chunks weren't sent; they stay on the list untouched
      }
    }

    const done = sending.filter(({ sku }) => totals.has(sku));
    setReceived((previous) => [...done.map(({ sku, name, quantity }) => ({ sku, name, quantity, total: totals.get(sku)! })), ...previous]);
    setLines((previous) => previous.filter((line) => !totals.has(line.sku)).map((line) => (errors.has(line.sku) ? { ...line, error: errors.get(line.sku) } : line)));
    setNotice(
      done.length === sending.length
        ? { kind: "success", text: t("result.all", { items: done.length, units: done.reduce((sum, d) => sum + d.quantity, 0) }) }
        : { kind: "error", text: t("result.partial", { received: done.length, failed: sending.length - done.length }) },
    );
    queryClient.invalidateQueries({ queryKey: ["items"] });
    queryClient.invalidateQueries({ queryKey: ["restock-sessions"] });
    setBusy(false);
  }

  const listboxId = "delivery-suggestions";
  const showSuggestions = suggestions.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/receive" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
          {t("oneAtATime")}
        </Link>
      </div>

      <SessionBanner isAdmin={isAdmin} />

      <div className="flex flex-col gap-3">
        {cameraOn && <CameraScanner onScan={addByCode} onClose={() => setCameraOn(false)} />}

        <div className="flex flex-col gap-2 sm:flex-row">
          <form
            className="relative flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitAddBox();
            }}
          >
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={addInput}
              role="combobox"
              aria-label={t("add.label")}
              aria-expanded={showSuggestions}
              aria-controls={listboxId}
              aria-activedescendant={showSuggestions ? `${listboxId}-${active}` : undefined}
              aria-describedby="delivery-add-hint"
              aria-autocomplete="list"
              placeholder={ready ? t("add.placeholder") : t("add.loading")}
              disabled={!ready || busy}
              value={query}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-12 pl-9 text-base"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && showSuggestions) {
                  event.preventDefault();
                  setActive((i) => (i + 1) % suggestions.length);
                } else if (event.key === "ArrowUp" && showSuggestions) {
                  event.preventDefault();
                  setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
                } else if (event.key === "Escape") {
                  setQuery("");
                }
              }}
            />
            {showSuggestions && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={t("add.label")}
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl"
              >
                {suggestions.map((item, i) => (
                  <li
                    key={item.sku}
                    id={`${listboxId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    // mousedown would blur the input before the click lands
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => addItem(item, "pick")}
                    className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === active && "bg-accent text-accent-foreground")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{item.sku}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("add.inStock", { count: item.quantityOnHand ?? 0 })}</span>
                  </li>
                ))}
              </ul>
            )}
          </form>
          <div className="flex gap-2">
            {!cameraOn && (
              <Button type="button" variant="outline" className="h-12 flex-1 sm:flex-none" disabled={!ready || busy} onClick={() => setCameraOn(true)}>
                <Camera className="size-4" />
                {t("add.camera")}
              </Button>
            )}
            <Button type="button" variant="outline" className="h-12 flex-1 sm:flex-none" disabled={!ready || busy} onClick={() => setImportOpen(true)}>
              <ClipboardPaste className="size-4" />
              {t("import.button")}
            </Button>
          </div>
        </div>
        <p id="delivery-add-hint" className="text-xs text-muted-foreground">
          {t("add.hint")}
        </p>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {resolving && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-info/10 px-4 py-3 text-sm text-info">
          {t("unmatched.resolving", { code: resolving.code, quantity: resolving.quantity ?? 1 })}
          <Button type="button" variant="ghost" className="h-8" onClick={() => setResolving(null)}>
            {t("unmatched.cancel")}
          </Button>
        </div>
      )}
      {notice && <NoticeBanner notice={notice} />}

      {unmatched.length > 0 && (
        <section aria-label={t("unmatched.title", { count: unmatched.length })} className="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <TriangleAlert className="size-4 text-warning" />
              {t("unmatched.title", { count: unmatched.length })}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("unmatched.hint")}</p>
          </div>
          <ul className="flex flex-col divide-y">
            {unmatched.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-mono">{row.code}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.quantity === null ? t("unmatched.badQuantity") : `× ${row.quantity}`}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={busy}
                  onClick={() => {
                    setResolving(row);
                    addInput.current?.focus();
                  }}
                >
                  {t("unmatched.find")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("unmatched.remove", { code: row.code })}
                  disabled={busy}
                  onClick={() => {
                    setUnmatched((previous) => previous.filter((r) => r.id !== row.id));
                    if (resolving?.id === row.id) setResolving(null);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!ready ? (
        <div className="h-48 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("add.loading")} />
      ) : rows.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <PackageOpen className="size-8 text-primary/70" />
          {t("list.empty")}
        </div>
      ) : (
        <section aria-label={t("list.label")} className="overflow-hidden rounded-2xl border bg-card">
          <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_5rem_10.5rem_5rem_2.5rem] items-center gap-3 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground md:grid">
            <span>{t("list.item")}</span>
            <span className="text-right">{t("list.inStock")}</span>
            <span className="text-center">{t("list.arriving")}</span>
            <span className="text-right">{t("list.newTotal")}</span>
            <span />
          </div>
          <ul className="divide-y">
            {rows.map(({ line, item }) => (
              <DeliveryRow key={line.sku} line={line} item={item} flash={flash === line.sku} busy={busy} actions={rowActions} />
            ))}
          </ul>
        </section>
      )}

      {rows.length > 0 && (
        // Stays in view however long the list gets. On phones it sits above the fixed tab bar.
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur md:bottom-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium tabular-nums">{t("summary", { items: rows.length, units: totalUnits })}</span>
            {invalidCount > 0 && <span className="text-xs text-destructive">{t("fixQuantities", { count: invalidCount })}</span>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => setConfirmClear(true)}>
              {t("clear")}
            </Button>
            <Button type="button" className="h-11 px-5" disabled={busy || invalidCount > 0} onClick={() => void submit()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? t("receiving") : failedCount > 0 ? t("retry", { count: failedCount }) : t("submit")}
            </Button>
          </div>
        </div>
      )}

      {received.length > 0 && (
        <section aria-label={t("received.title")} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("received.title")}</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {received.map((entry, i) => (
              <li key={`${entry.sku}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  +{entry.quantity} × {entry.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{t("received.now", { total: entry.total })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DeliveryImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={importList} />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("clearTitle")}
        description={t("clearDescription")}
        confirmLabel={t("clear")}
        destructive
        onConfirm={() => {
          setLines([]);
          setUnmatched([]);
          setResolving(null);
          setNotice(null);
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
