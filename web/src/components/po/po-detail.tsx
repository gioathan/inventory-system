"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Loader2, PackageCheck, Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ItemImage } from "@/components/item-image";
import { NoticeBanner } from "@/components/notice-banner";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useItems } from "@/hooks/use-items";
import type { Notice } from "@/hooks/use-item-lookup";
import { usePurchaseOrder } from "@/hooks/use-purchase-orders";
import { ApiError, apiFetch } from "@/lib/api";
import { canCancel, canReceive, canSend, formatDate, MAX_LINE_QUANTITY, PO_STATUS, shortId, totals, type PoLine, type PurchaseOrder } from "@/lib/po";
import { cn } from "@/lib/utils";

const parseQuantity = (raw: string | undefined) => (raw && /^\d+$/.test(raw) ? Math.min(Number(raw), MAX_LINE_QUANTITY) : 0);

export function PoDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const query = usePurchaseOrder(id);
  const items = useItems();
  const itemBySku = useMemo(() => new Map((items.data ?? []).map((i) => [i.sku, i])), [items.data]);

  const [confirm, setConfirm] = useState<"send" | "cancel" | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  function apply(order: PurchaseOrder) {
    queryClient.setQueryData(["purchase-orders", id], order);
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  }

  // A 409 means the order moved on since this screen loaded (someone else sent or cancelled it):
  // say so, then reload so the buttons and status match reality.
  function handleConflict(error: unknown) {
    if (error instanceof ApiError && error.status === 409) void query.refetch();
  }

  const send = useMutation({
    mutationFn: () => apiFetch<PurchaseOrder>("gateway", `purchase-orders/${id}/send`, { method: "POST" }),
    onSuccess: (order) => {
      apply(order);
      setConfirm(null);
      setNotice({ kind: "success", text: `Order sent to ${order.supplierName}.` });
    },
    onError: (error) => {
      setConfirmError(error instanceof Error ? error.message : "Couldn't send the order.");
      handleConflict(error);
    },
  });

  const cancel = useMutation({
    mutationFn: () => apiFetch<PurchaseOrder>("gateway", `purchase-orders/${id}/cancel`, { method: "POST" }),
    onSuccess: (order) => {
      apply(order);
      setConfirm(null);
      setReceiving(false);
      setNotice({ kind: "success", text: "Order cancelled." });
    },
    onError: (error) => {
      setConfirmError(error instanceof Error ? error.message : "Couldn't cancel the order.");
      handleConflict(error);
    },
  });

  const receive = useMutation({
    mutationFn: (lines: { sku: string; quantity: number }[]) =>
      apiFetch<PurchaseOrder>("gateway", `purchase-orders/${id}/receive`, { method: "POST", body: JSON.stringify({ lines }) }),
    onSuccess: (order, lines) => {
      apply(order);
      queryClient.invalidateQueries({ queryKey: ["items"] }); // stock changed
      setReceiving(false);
      setQuantities({});
      const units = lines.reduce((sum, l) => sum + l.quantity, 0);
      setNotice({
        kind: "success",
        text: `Recorded ${units} ${units === 1 ? "unit" : "units"}. ${order.status === "Received" ? "The order is now complete." : "The rest is still expected."}`,
      });
    },
    onError: (error) => {
      setReceiveError(error instanceof Error ? error.message : "Couldn't record the shipment.");
      handleConflict(error);
    },
  });

  if (query.isPending) return <div className="h-64 animate-pulse rounded-2xl border bg-muted/40" aria-label="Loading purchase order" />;

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
        <p className="text-destructive">{missing ? "This purchase order doesn't exist." : `Couldn't load it: ${query.error.message}`}</p>
        <Link href="/purchase-orders" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
          Back to purchase orders
        </Link>
      </div>
    );
  }

  const order = query.data;
  const status = PO_STATUS[order.status];
  const { ordered, received, remaining } = totals(order);

  const entries = order.lines
    .map((line) => ({ line, quantity: parseQuantity(quantities[line.sku]) }))
    .filter((entry) => entry.quantity > 0);
  const recordUnits = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const overLines = entries.filter((e) => e.line.receivedQuantity + e.quantity > e.line.orderedQuantity);

  function fillRemaining(line: PoLine) {
    const left = Math.max(0, line.orderedQuantity - line.receivedQuantity);
    setQuantities((q) => ({ ...q, [line.sku]: left > 0 ? String(left) : "" }));
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/purchase-orders" className={cn(buttonVariants({ variant: "ghost" }), "-ml-3 h-9 w-fit gap-2")}>
        <ArrowLeft className="size-4" />
        Purchase orders
      </Link>

      <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{order.supplierName}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {shortId(order.id)} · opened {formatDate(order.openedAt)}
              {order.closedAt && ` · closed ${formatDate(order.closedAt)}`}
            </p>
          </div>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>

        <p className="text-sm text-muted-foreground">{status.hint}</p>

        <div className="flex flex-col gap-1.5">
          <ProgressBar value={received} max={ordered} label="Units received" className="h-2.5" />
          <div className="flex items-baseline justify-between text-sm">
            <span className="tabular-nums">
              <span className="font-semibold">{received}</span> of {ordered} units received
            </span>
            {remaining > 0 && order.status !== "Cancelled" && <span className="tabular-nums text-muted-foreground">{remaining} to go</span>}
          </div>
        </div>

        {(canSend(order.status) || canReceive(order.status) || canCancel(order.status)) && (
          <div className="flex flex-wrap gap-2">
            {canSend(order.status) && (
              <Button type="button" className="h-11 gap-2" onClick={() => { setConfirmError(null); setConfirm("send"); }}>
                <Send className="size-4" />
                Send to supplier
              </Button>
            )}
            {canReceive(order.status) && !receiving && (
              <Button type="button" className="h-11 gap-2" onClick={() => { setReceiveError(null); setReceiving(true); }}>
                <PackageCheck className="size-4" />
                Record shipment
              </Button>
            )}
            {canCancel(order.status) && (
              <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => { setConfirmError(null); setConfirm("cancel"); }}>
                <Ban className="size-4" />
                Cancel order
              </Button>
            )}
          </div>
        )}
      </header>

      {notice && <NoticeBanner notice={notice} />}

      {receiving && canReceive(order.status) && (
        <form
          aria-label="Record a shipment"
          className="flex flex-col gap-4 rounded-2xl border border-primary/40 bg-primary/5 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (entries.length === 0) return;
            setReceiveError(null);
            receive.mutate(entries.map((e) => ({ sku: e.line.sku, quantity: e.quantity })));
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Record a shipment</h2>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => setQuantities(Object.fromEntries(order.lines.map((l) => [l.sku, Math.max(0, l.orderedQuantity - l.receivedQuantity) > 0 ? String(l.orderedQuantity - l.receivedQuantity) : ""])))}
            >
              Fill everything still due
            </button>
          </div>
          <p className="text-sm text-muted-foreground">Enter how many of each item arrived in this delivery. Leave the rest blank.</p>

          <ul className="flex flex-col gap-3">
            {order.lines.map((line) => {
              const item = itemBySku.get(line.sku);
              const left = Math.max(0, line.orderedQuantity - line.receivedQuantity);
              const entered = parseQuantity(quantities[line.sku]);
              const over = entered > 0 && line.receivedQuantity + entered > line.orderedQuantity;
              return (
                <li key={line.sku} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
                  <ItemImage src={item?.imageUrl ?? null} alt="" className="size-11 rounded-lg" />
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="truncate font-medium">{item?.name ?? line.sku}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {left > 0 ? `${left} still due` : "Fully received"} · {line.receivedQuantity} of {line.orderedQuantity} in
                    </div>
                    {over && (
                      <StatusPill tone="warning" className="mt-1 px-2 py-0.5">
                        Over the order by {line.receivedQuantity + entered - line.orderedQuantity}
                      </StatusPill>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`Received quantity for ${item?.name ?? line.sku}`}
                      value={quantities[line.sku] ?? ""}
                      onChange={(event) => setQuantities((q) => ({ ...q, [line.sku]: event.target.value.replace(/\D/g, "").slice(0, 5) }))}
                      disabled={receive.isPending}
                      className="h-11 w-24 text-center tabular-nums"
                    />
                    <Button type="button" variant="outline" className="h-11" disabled={receive.isPending || left === 0} onClick={() => fillRemaining(line)}>
                      Fill
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {overLines.length > 0 && (
            <p role="status" className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">
              {overLines.length === 1 ? "One item exceeds" : `${overLines.length} items exceed`} what was ordered. That&apos;s allowed (suppliers over-ship), but check the delivery.
            </p>
          )}
          {receiveError && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {receiveError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="h-11 gap-2" disabled={entries.length === 0 || receive.isPending}>
              {receive.isPending && <Loader2 className="size-4 animate-spin" />}
              Add {recordUnits > 0 ? `${recordUnits} ${recordUnits === 1 ? "unit" : "units"}` : ""} to stock
            </Button>
            <Button type="button" variant="ghost" className="h-11" disabled={receive.isPending} onClick={() => { setReceiving(false); setQuantities({}); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <section aria-label="Order lines" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Items ({order.lines.length})
        </h2>
        <ul className="divide-y rounded-2xl border bg-card">
          {order.lines.map((line) => {
            const item = itemBySku.get(line.sku);
            const over = Math.max(0, line.receivedQuantity - line.orderedQuantity);
            const left = Math.max(0, line.orderedQuantity - line.receivedQuantity);
            return (
              <li key={line.sku} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                <ItemImage src={item?.imageUrl ?? null} alt="" className="size-11 rounded-lg" />
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate font-medium">{item?.name ?? line.sku}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{line.sku}</div>
                </div>
                <div className="flex w-full flex-col gap-1 sm:w-56">
                  <ProgressBar value={line.receivedQuantity} max={line.orderedQuantity} label={`${item?.name ?? line.sku} received`} />
                  <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                    <span>
                      {line.receivedQuantity} of {line.orderedQuantity}
                    </span>
                    {over > 0 ? (
                      <StatusPill tone="warning" className="px-2 py-0.5">
                        Over by {over}
                      </StatusPill>
                    ) : left > 0 ? (
                      <span>{left} due</span>
                    ) : (
                      <span className="text-success">Complete</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <ConfirmDialog
        open={confirm === "send"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Send this order?"
        description={`This marks the order as sent to ${order.supplierName}. You can still cancel it, but its lines can't be changed.`}
        confirmLabel="Send order"
        pending={send.isPending}
        error={confirmError}
        onConfirm={() => { setConfirmError(null); send.mutate(); }}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Cancel this order?"
        description={
          received > 0
            ? "The order will be closed and can't be reopened. Stock you've already received stays on hand."
            : "The order will be closed and can't be reopened."
        }
        confirmLabel="Cancel order"
        destructive
        pending={cancel.isPending}
        error={confirmError}
        onConfirm={() => { setConfirmError(null); cancel.mutate(); }}
      />
    </div>
  );
}
