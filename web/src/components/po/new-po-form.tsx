"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { ItemImage } from "@/components/item-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useItems } from "@/hooks/use-items";
import { apiFetch } from "@/lib/api";
import { MAX_LINE_QUANTITY, type PurchaseOrder } from "@/lib/po";
import { ItemPicker } from "./item-picker";

// Quantities are strings while they're being typed; converted to numbers only at submit, after
// validation has guaranteed the conversion is safe.
const schema = z.object({
  supplierName: z.string().trim().min(1, "Enter the supplier's name.").max(200, "Keep it under 200 characters."),
  lines: z
    .array(
      z.object({
        sku: z.string(),
        quantity: z
          .string()
          .trim()
          .regex(/^\d+$/, "Enter a whole number.")
          .refine((v) => Number(v) >= 1 && Number(v) <= MAX_LINE_QUANTITY, "Enter 1 to 99,999."),
      }),
    )
    .min(1, "Add at least one item to order."),
});
type FormValues = z.infer<typeof schema>;

export function NewPoForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const items = useItems();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { supplierName: "", lines: [] } });
  const { control, register, handleSubmit, formState } = form;
  const { errors } = formState;
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watched = useWatch({ control, name: "lines" });

  const itemBySku = useMemo(() => new Map((items.data ?? []).map((i) => [i.sku, i])), [items.data]);
  const totalUnits = (watched ?? []).reduce((sum, l) => sum + (/^\d+$/.test(l?.quantity ?? "") ? Number(l.quantity) : 0), 0);

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      apiFetch<PurchaseOrder>("gateway", "purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierName: values.supplierName,
          lines: values.lines.map((l) => ({ sku: l.sku, quantity: Number(l.quantity) })),
        }),
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.push(`/purchase-orders/${order.id}`);
    },
    onError: (error) => setSubmitError(error instanceof Error ? error.message : "Couldn't create the order. Try again."),
  });

  const lineListError = errors.lines?.message ?? errors.lines?.root?.message;

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => {
        setSubmitError(null);
        create.mutate(values);
      })}
      className="flex flex-col gap-6"
    >
      <FormField id="supplierName" label="Supplier" error={errors.supplierName?.message} hint="Who you're ordering from.">
        <Input
          id="supplierName"
          autoComplete="off"
          aria-invalid={!!errors.supplierName}
          aria-describedby="supplierName-msg"
          className="h-11"
          {...register("supplierName")}
        />
      </FormField>

      <section aria-label="Order lines" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Items</h2>
          {fields.length > 0 && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {fields.length} {fields.length === 1 ? "line" : "lines"} · {totalUnits} units
            </span>
          )}
        </div>

        <ItemPicker
          excluded={fields.map((f) => f.sku)}
          onPick={(item) => append({ sku: item.sku, quantity: "1" })}
        />

        {fields.length === 0 ? (
          <p className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm ${lineListError ? "border-destructive/50 text-destructive" : "text-muted-foreground"}`} role={lineListError ? "alert" : undefined}>
            {lineListError ?? "Search above to add the items you're ordering."}
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {fields.map((field, index) => {
              const item = itemBySku.get(field.sku);
              const quantityError = errors.lines?.[index]?.quantity?.message;
              return (
                <li key={field.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <ItemImage src={item?.imageUrl ?? null} alt="" className="size-11 rounded-lg" />
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="truncate font-medium">{item?.name ?? field.sku}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{field.sku}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`Quantity of ${item?.name ?? field.sku}`}
                      aria-invalid={!!quantityError}
                      className="h-11 w-24 text-center tabular-nums"
                      {...register(`lines.${index}.quantity`)}
                    />
                    {quantityError && (
                      <span role="alert" className="text-xs text-destructive">
                        {quantityError}
                      </span>
                    )}
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item?.name ?? field.sku}`} className="size-10" onClick={() => remove(index)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {submitError && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {submitError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="h-11 px-6" disabled={create.isPending}>
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          Create order
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={create.isPending} onClick={() => router.push("/purchase-orders")}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The order is saved as a draft. Nothing is sent to the supplier until you send it.</p>
    </form>
  );
}
