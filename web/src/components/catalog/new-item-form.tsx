"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { ItemImage } from "@/components/item-image";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useCategories, useCategoryTree } from "@/hooks/use-items";
import { leafOptions } from "@/lib/categories";
import { useImageUpload } from "@/hooks/use-image-upload";
import { ApiError, apiFetch } from "@/lib/api";
import type { ReceiveResult } from "@/lib/types";

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Fields are strings (that's what inputs hold); they're converted to numbers at submit, after
// validation has guaranteed the conversion is safe.
// Built inside the component (memoized) rather than at module level, because its messages come
// from the active locale's translations, and those are only reachable through a hook.
type CatalogT = ReturnType<typeof useTranslations<"catalog">>;
function makeSchema(t: CatalogT) {
  return z.object({
    name: z.string().trim().min(1, t("validation.nameRequired")).max(200, t("validation.nameTooLong")),
    price: z
      .string()
      .trim()
      .regex(/^\d{1,7}(\.\d{1,2})?$/, t("validation.priceFormat"))
      .refine((v) => Number(v) > 0, t("validation.pricePositive")),
    quantity: z
      .string()
      .trim()
      .regex(/^\d+$/, t("validation.wholeNumber"))
      .refine((v) => Number(v) >= 1 && Number(v) <= 99_999, t("validation.quantityRange")),
    categoryId: z.string(),
    barcode: z.string().trim().regex(/^[A-Za-z0-9._-]{0,64}$/, t("validation.barcodeFormat")),
    imageUrl: z
      .string()
      .trim()
      .refine((v) => v === "" || isHttpUrl(v), t("validation.imageUrl")),
  });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

export function NewItemForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const tree = useCategoryTree();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const schema = useMemo(() => makeSchema(t), [t]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", price: "", quantity: "1", categoryId: "", barcode: "", imageUrl: "" },
  });
  const { register, handleSubmit, setValue, setError, control, formState } = form;
  const { errors } = formState;
  const imageUrl = useWatch({ control, name: "imageUrl" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const { fileInput, uploading, error: uploadError, onFileInputChange, pick } = useImageUpload((url) => setValue("imageUrl", url, { shouldValidate: true }));

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      apiFetch<ReceiveResult>("gateway", "items/intake", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          price: Number(values.price),
          quantity: Number(values.quantity),
          categoryId: values.categoryId || null,
          imageUrl: values.imageUrl || null,
          barcode: values.barcode || null,
        }),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      router.push(`/catalog?sku=${encodeURIComponent(created.sku)}`);
    },
    onError: (error) => {
      // A taken barcode belongs on the barcode field, not in a generic banner.
      if (error instanceof ApiError && error.status === 409) {
        setError("barcode", { message: t("newItem.barcodeTaken") });
      } else if (error instanceof ApiError && error.status === 400 && /barcode/i.test(error.message)) {
        setError("barcode", { message: error.message });
      } else {
        setSubmitError(error instanceof Error ? error.message : t("newItem.createFailed"));
      }
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => {
        setSubmitError(null);
        create.mutate(values);
      })}
      noValidate
      className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16rem]"
    >
      <div className="flex flex-col gap-5">
        <FormField id="name" label={t("fields.name")} error={errors.name?.message}>
          <Input id="name" autoComplete="off" aria-invalid={!!errors.name} aria-describedby="name-msg" className="h-11" {...register("name")} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="price" label={t("fields.price")} error={errors.price?.message}>
            <Input id="price" inputMode="decimal" placeholder="0.00" autoComplete="off" aria-invalid={!!errors.price} aria-describedby="price-msg" className="h-11" {...register("price")} />
          </FormField>
          <FormField id="quantity" label={t("fields.startingStock")} error={errors.quantity?.message} hint={t("newItem.startingStockHint")}>
            <Input id="quantity" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.quantity} aria-describedby="quantity-msg" className="h-11" {...register("quantity")} />
          </FormField>
        </div>

        <FormField
          id="categoryId"
          label={t("fields.category")}
          hint={categories.isError ? t("newItem.categoriesError") : t("newItem.optional")}
        >
          <Combobox
            id="categoryId"
            aria-describedby="categoryId-msg"
            value={categoryId}
            onValueChange={(v) => setValue("categoryId", v, { shouldValidate: true, shouldDirty: true })}
            options={[{ value: "", label: t("fields.noCategory") }, ...leafOptions(tree)]}
          />
        </FormField>

        <FormField
          id="barcode"
          label={t("fields.barcode")}
          error={errors.barcode?.message}
          hint={t("newItem.barcodeHint")}
        >
          <Input id="barcode" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!!errors.barcode} aria-describedby="barcode-msg" className="h-11 font-mono" {...register("barcode")} />
        </FormField>

        {submitError && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {submitError}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" className="h-11 px-6" disabled={create.isPending || uploading}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("newItem.create")}
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={() => router.push("/catalog")} disabled={create.isPending}>
            {tc("actions.cancel")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <FormField id="imageUrl" label={t("fields.image")} error={errors.imageUrl?.message} hint={t("newItem.imageHint")}>
          <Input id="imageUrl" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://…" aria-invalid={!!errors.imageUrl} aria-describedby="imageUrl-msg" className="h-11" {...register("imageUrl")} />
        </FormField>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={t("image.uploadAria")}
          tabIndex={-1}
          onChange={onFileInputChange}
        />
        <Button type="button" variant="outline" className="h-11 gap-2" disabled={uploading} onClick={pick}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
          {uploading ? t("image.uploading") : t("image.uploadFile")}
        </Button>
        {uploadError && (
          <p role="alert" className="text-sm text-destructive">
            {uploadError}
          </p>
        )}

        <ItemImage src={imageUrl && isHttpUrl(imageUrl) ? imageUrl : null} alt={t("image.preview")} className="size-40 self-center md:self-start" />
      </div>
    </form>
  );
}
