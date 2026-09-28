"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCurrentSession } from "@/hooks/use-restock-sessions";
import { scanPath } from "@/hooks/use-item-lookup";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/time";
import type { CatalogEntry, ReceiveResult } from "@/lib/types";
import { MAX_RECEIVE_QUANTITY } from "./receive-card";

type RowState = { quantity: string; status: "idle" | "saving" | "done" | "error"; message?: string; newTotal?: number };

const PRESETS = [1, 5, 10];

// Receive stock for one or several items without leaving the screen you're on (catalog, stock
// lookup, dashboard). Each item posts on its own, like the Receive screen: a failure on one line
// never loses the others, and the dialog stays open showing which ones still need attention.
export function QuickReceiveDialog({
  open,
  onOpenChange,
  items,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CatalogEntry[];
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const session = useCurrentSession();
  const single = items.length === 1;
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);

  // Start fresh each time the dialog opens: one item defaults to 1, several start empty so only
  // the ones you fill in are received.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = open ? items.map((i) => i.sku).join(",") : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    setRows(Object.fromEntries(items.map((i) => [i.sku, { quantity: single ? "1" : "", status: "idle" as const }])));
  }

  const parsed = (q: string) => (/^\d+$/.test(q.trim()) ? Number(q) : q.trim() === "" ? 0 : NaN);
  const pending = items.filter((i) => rows[i.sku] && rows[i.sku].status !== "done");
  const invalid = pending.some((i) => {
    const n = parsed(rows[i.sku].quantity);
    return Number.isNaN(n) || n > MAX_RECEIVE_QUANTITY;
  });
  const toSend = pending.filter((i) => parsed(rows[i.sku].quantity) > 0);
  const anyDone = items.some((i) => rows[i.sku]?.status === "done");
  const anyError = items.some((i) => rows[i.sku]?.status === "error");

  function update(sku: string, patch: Partial<RowState>) {
    setRows((r) => ({ ...r, [sku]: { ...r[sku], ...patch } }));
  }

  async function submit() {
    setBusy(true);
    let failed = false;
    for (const item of toSend) {
      const quantity = parsed(rows[item.sku].quantity);
      update(item.sku, { status: "saving", message: undefined });
      try {
        const result = await apiFetch<ReceiveResult>("gateway", `${scanPath(item.barcode)}/receive`, {
          method: "POST",
          body: JSON.stringify({ quantity }),
        });
        update(item.sku, { status: "done", newTotal: result.quantityOnHand });
      } catch (error) {
        failed = true;
        update(item.sku, { status: "error", message: error instanceof Error ? error.message : "Couldn't add this one." });
      }
    }
    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ["items"] });
    queryClient.invalidateQueries({ queryKey: ["restock-sessions"] });
    if (!failed) {
      onDone?.();
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? `Receive ${items[0]?.name ?? ""}` : `Receive ${items.length} items`}</DialogTitle>
          <DialogDescription>
            {session.data
              ? `Logged to the restock session open since ${formatDateTime(session.data.openedAt)}.`
              : "No restock session is open; the stock is still added."}
            {!single && " Leave a quantity empty to skip that item."}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-[50dvh] flex-col divide-y overflow-y-auto">
          {items.map((item) => {
            const row = rows[item.sku];
            if (!row) return null;
            const n = parsed(row.quantity);
            const bad = Number.isNaN(n) || n > MAX_RECEIVE_QUANTITY;
            const id = `receive-${item.sku}`;
            return (
              <li key={item.sku} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={id} className="min-w-0 truncate text-sm font-medium">
                    {single ? "Quantity" : item.name}
                  </label>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {row.status === "done"
                      ? `Added · now ${row.newTotal}`
                      : `${item.quantityOnHand ?? 0} in stock${n > 0 && !bad ? ` → ${(item.quantityOnHand ?? 0) + n}` : ""}`}
                  </span>
                </div>
                {row.status === "done" ? (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <Check className="size-4" /> Added {row.quantity}
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      value={row.quantity}
                      disabled={busy}
                      autoFocus={single}
                      onChange={(e) => update(item.sku, { quantity: e.target.value.replace(/[^\d]/g, "") })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && toSend.length > 0 && !invalid && !busy) void submit();
                      }}
                      aria-invalid={bad}
                      aria-describedby={row.message ? `${id}-msg` : undefined}
                      className="h-10 w-24 tabular-nums"
                    />
                    {PRESETS.map((p) => (
                      <Button
                        key={p}
                        type="button"
                        variant="outline"
                        className="h-10 px-3 tabular-nums"
                        disabled={busy}
                        aria-label={`Add ${p} to ${item.name}`}
                        onClick={() => update(item.sku, { quantity: String((Number.isNaN(n) ? 0 : n) + p) })}
                      >
                        +{p}
                      </Button>
                    ))}
                    {row.status === "saving" && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Adding" />}
                  </div>
                )}
                {bad && <p className="text-xs text-destructive">Enter a whole number up to {MAX_RECEIVE_QUANTITY.toLocaleString()}.</p>}
                {row.message && (
                  <p id={`${id}-msg`} role="alert" className="text-xs text-destructive">
                    {row.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button type="button" variant="ghost" className="h-10" disabled={busy} onClick={() => onOpenChange(false)}>
            {anyDone ? "Close" : "Cancel"}
          </Button>
          <Button type="button" className="h-10" disabled={busy || invalid || toSend.length === 0} onClick={() => void submit()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {anyError ? "Retry the rest" : single ? "Add to stock" : `Add to stock (${toSend.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
