"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import type { CatalogEntry } from "@/lib/types";

const PERCENT = /^\d{1,2}(\.\d{1,2})?$/;

// Applies one percentage off to many items at once, or clears it. The backend takes the
// discount as a fraction strictly between 0 and 1 and never touches the item's list price, so
// removing it is an exact, lossless revert — worth saying in the dialog, since it's what makes
// a bulk change safe to try.
export function DiscountDialog({
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
  const [percent, setPercent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const skus = items.map((i) => i.sku);
  const anyDiscounted = items.some((i) => i.discountPercentage !== null);
  const valid = PERCENT.test(percent.trim()) && Number(percent) > 0 && Number(percent) < 100;

  function finish() {
    queryClient.invalidateQueries({ queryKey: ["items"] });
    onDone?.();
    onOpenChange(false);
    setPercent("");
    setError(null);
  }

  const apply = useMutation({
    mutationFn: () =>
      apiFetch("gateway", "items/discount", {
        method: "POST",
        body: JSON.stringify({ skus, percentage: Number(percent) / 100 }),
      }),
    onSuccess: finish,
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't apply the discount."),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch("gateway", "items/discount/remove", { method: "POST", body: JSON.stringify({ skus }) }),
    onSuccess: finish,
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't remove the discount."),
  });

  const busy = apply.isPending || remove.isPending;
  const preview = items.slice(0, 4).map((i) => i.name);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Discount {items.length} {items.length === 1 ? "item" : "items"}
          </DialogTitle>
          <DialogDescription>
            The list price never changes, so removing a discount always restores it exactly.
          </DialogDescription>
        </DialogHeader>

        {items.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {preview.join(", ")}
            {items.length > preview.length && ` and ${items.length - preview.length} more`}
          </p>
        )}

        <FormField id="discount-percent" label="Percent off" hint="From 0.01 to 99.99." error={error ?? undefined}>
          <div className="relative">
            <Input
              id="discount-percent"
              inputMode="decimal"
              autoComplete="off"
              placeholder="20"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              aria-describedby="discount-percent-msg"
              className="h-11 pr-8"
            />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              %
            </span>
          </div>
        </FormField>

        <DialogFooter>
          {anyDiscounted && (
            <Button type="button" variant="outline" className="h-10" disabled={busy || items.length === 0} onClick={() => remove.mutate()}>
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove discount
            </Button>
          )}
          <Button type="button" className="h-10" disabled={!valid || busy || items.length === 0} onClick={() => apply.mutate()}>
            {apply.isPending && <Loader2 className="size-4 animate-spin" />}
            Apply {valid ? `${Number(percent)}%` : "discount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
