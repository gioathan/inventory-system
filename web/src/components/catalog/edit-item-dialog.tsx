"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { ItemImage } from "@/components/item-image";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCategories } from "@/hooks/use-items";
import { useImageUpload } from "@/hooks/use-image-upload";
import { ApiError, apiFetch } from "@/lib/api";
import type { CatalogEntry } from "@/lib/types";

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Same field-level rules as NewItemForm, minus quantity (stock isn't edited here) and with
// barcode required — unlike creating an item, there's already one to keep unless this edit
// changes it.
const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200, "Keep it under 200 characters."),
  price: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter a price like 12.99.")
    .refine((v) => Number(v) > 0, "The price must be more than 0."),
  categoryId: z.string(),
  barcode: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/, "Use letters, digits, . _ or - only (up to 64)."),
  imageUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || isHttpUrl(v), "Enter a full web address starting with http:// or https://."),
});
type FormValues = z.infer<typeof schema>;

// A full replace of the editable fields, matching the backend's own PUT semantics — every field
// is resubmitted, not just the ones the admin touched. Sku is shown but never editable: it's the
// key Inventory, Purchase Orders and printed labels already carry (see docs/architecture.md), so
// renaming it here would silently orphan all of those elsewhere in the system.
export function EditItemDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CatalogEntry;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const categories = useCategories();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toDefaults(item),
  });
  const { register, handleSubmit, setValue, setError, reset, control, formState } = form;
  const { errors } = formState;
  const imageUrl = useWatch({ control, name: "imageUrl" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const { fileInput, uploading, error: uploadError, onFileInputChange, pick } = useImageUpload((url) => setValue("imageUrl", url, { shouldValidate: true }));

  // Re-fill the form whenever a different item is opened, or the dialog reopens on the same one
  // after a previous edit changed it — defaultValues alone only apply on the form's first mount.
  useEffect(() => {
    if (open) reset(toDefaults(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset identity is stable; re-run only on open/item change
  }, [open, item]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      apiFetch<CatalogEntry>("gateway", `items/${encodeURIComponent(item.sku)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: values.name,
          price: Number(values.price),
          barcode: values.barcode,
          categoryId: values.categoryId || null,
          imageUrl: values.imageUrl || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setError("barcode", { message: "Another item already uses that barcode." });
      } else if (error instanceof ApiError && error.status === 400 && /barcode/i.test(error.message)) {
        setError("barcode", { message: error.message });
      } else {
        setError("root", { message: error instanceof Error ? error.message : "Couldn't save the changes. Try again." });
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>
            SKU <span className="font-mono">{item.sku}</span> stays the same — it&apos;s the key stock, purchase orders and printed
            labels already carry for this item.
          </DialogDescription>
        </DialogHeader>

        <form
          id="edit-item-form"
          onSubmit={handleSubmit((values) => save.mutate(values))}
          noValidate
          className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_11rem]"
        >
          <div className="flex flex-col gap-4">
            <FormField id="edit-name" label="Name" error={errors.name?.message}>
              <Input id="edit-name" autoComplete="off" aria-invalid={!!errors.name} aria-describedby="edit-name-msg" className="h-11" {...register("name")} />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="edit-price" label="Price" error={errors.price?.message}>
                <Input id="edit-price" inputMode="decimal" autoComplete="off" aria-invalid={!!errors.price} aria-describedby="edit-price-msg" className="h-11" {...register("price")} />
              </FormField>
              <FormField
                id="edit-categoryId"
                label="Category"
                hint={categories.isError ? "Couldn't load categories." : undefined}
              >
                <Combobox
                  id="edit-categoryId"
                  aria-describedby="edit-categoryId-msg"
                  value={categoryId}
                  onValueChange={(v) => setValue("categoryId", v, { shouldValidate: true, shouldDirty: true })}
                  options={[{ value: "", label: "No category" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                />
              </FormField>
            </div>

            <FormField
              id="edit-barcode"
              label="Barcode"
              error={errors.barcode?.message}
              hint="Changing this won't update labels already printed with the old one."
            >
              <Input
                id="edit-barcode"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!errors.barcode}
                aria-describedby="edit-barcode-msg"
                className="h-11 font-mono"
                {...register("barcode")}
              />
            </FormField>

            {errors.root?.message && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errors.root.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <FormField id="edit-imageUrl" label="Image" error={errors.imageUrl?.message} hint="Paste an address, or upload a file.">
              <Input
                id="edit-imageUrl"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://…"
                aria-invalid={!!errors.imageUrl}
                aria-describedby="edit-imageUrl-msg"
                className="h-11"
                {...register("imageUrl")}
              />
            </FormField>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Upload an image file"
              tabIndex={-1}
              onChange={onFileInputChange}
            />
            <Button type="button" variant="outline" className="h-10 gap-2" disabled={uploading} onClick={pick}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
              {uploading ? "Uploading…" : "Upload a file"}
            </Button>
            {uploadError && (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            )}

            <ItemImage src={imageUrl && isHttpUrl(imageUrl) ? imageUrl : null} alt="Item preview" className="size-28 self-center" />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" className="h-10" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-item-form" className="h-10" disabled={save.isPending || uploading}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDefaults(item: CatalogEntry): FormValues {
  return {
    name: item.name,
    price: item.price.toFixed(2),
    categoryId: item.categoryId ?? "",
    barcode: item.barcode,
    imageUrl: item.imageUrl ?? "",
  };
}
