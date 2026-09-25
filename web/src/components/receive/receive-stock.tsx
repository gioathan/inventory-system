"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NoticeBanner } from "@/components/notice-banner";
import { ScanInput } from "@/components/scan/scan-input";
import { scanPath, useItemLookup } from "@/hooks/use-item-lookup";
import { apiFetch } from "@/lib/api";
import type { ReceiveResult } from "@/lib/types";
import { ReceiveCard } from "./receive-card";

interface Received {
  id: number;
  name: string;
  quantity: number;
  newTotal: number;
  at: Date;
}

export function ReceiveStock({ initialCode }: { initialCode?: string }) {
  const queryClient = useQueryClient();
  const { item, setItem, notice, setNotice, lookup, clear } = useItemLookup();
  const [quantity, setQuantity] = useState(1);
  const [received, setReceived] = useState<Received[]>([]);

  // Arriving from the Stock screen's "Receive" button: look the item up straight away. Guarded
  // so React strict mode's double-invoked effect doesn't fire the lookup twice.
  const { mutate: lookupItem } = lookup;
  const autoLooked = useRef(false);
  useEffect(() => {
    if (initialCode && !autoLooked.current) {
      autoLooked.current = true;
      lookupItem(initialCode);
    }
  }, [initialCode, lookupItem]);

  // Posts immediately, one call per confirm, so nothing is lost if the phone dies mid-delivery
  // and there's no half-committed batch to reconcile. The list below is history, not a cart.
  const receive = useMutation({
    mutationFn: (current: { barcode: string; quantity: number }) =>
      apiFetch<ReceiveResult>("gateway", `${scanPath(current.barcode)}/receive`, {
        method: "POST",
        body: JSON.stringify({ quantity: current.quantity }),
      }),
    onSuccess: (updated, added) => {
      setReceived((previous) =>
        [{ id: Date.now(), name: updated.name, quantity: added.quantity, newTotal: updated.quantityOnHand, at: new Date() }, ...previous].slice(0, 10),
      );
      setNotice({ kind: "success", text: `Added ${added.quantity} × ${updated.name} · now ${updated.quantityOnHand} on hand` });
      setItem(null);
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Couldn't add that stock. Try again." });
    },
  });

  const busy = lookup.isPending || receive.isPending;
  const totalUnits = received.reduce((sum, entry) => sum + entry.quantity, 0);

  function handleScan(code: string) {
    if (busy) return;
    lookup.mutate(code, { onSuccess: () => setQuantity(1) });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Receive stock</h1>
        <p className="text-sm text-muted-foreground">Scan what arrived, enter how many, and add it to stock.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <ScanInput onScan={handleScan} disabled={busy} />

        <div className="flex flex-col gap-4" aria-live="polite">
          {notice && <NoticeBanner notice={notice} />}

          {lookup.isPending ? (
            <div className="h-80 animate-pulse rounded-2xl border bg-muted/40" aria-label="Looking up item" />
          ) : item ? (
            <ReceiveCard
              item={item}
              quantity={quantity}
              onQuantityChange={setQuantity}
              onConfirm={() => receive.mutate({ barcode: item.barcode, quantity })}
              onClear={clear}
              receiving={receive.isPending}
            />
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              <PackageOpen className="size-8 text-primary/70" />
              Ready to receive. Scan an item to begin.
            </div>
          )}
        </div>
      </div>

      {received.length > 0 && (
        <section aria-label="Received this session" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Received this session</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{totalUnits} units</span>
          </div>
          <ul className="divide-y rounded-xl border bg-card">
            {received.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  +{entry.quantity} × {entry.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  now {entry.newTotal} · {entry.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
