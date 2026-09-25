"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { ItemImage } from "@/components/item-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useCategories } from "@/hooks/use-items";
import { ApiError, apiFetch } from "@/lib/api";
import type { ReceiveResult } from "@/lib/types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // Cloudflare Images' own per-file limit.

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
const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200, "Keep it under 200 characters."),
  price: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter a price like 12.99.")
    .refine((v) => Number(v) > 0, "The price must be more than 0."),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number.")
    .refine((v) => Number(v) >= 1 && Number(v) <= 99_999, "Enter a number from 1 to 99,999."),
  categoryId: z.string(),
  barcode: z.string().trim().regex(/^[A-Za-z0-9._-]{0,64}$/, "Use letters, digits, . _ or - only (up to 64)."),
  imageUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || isHttpUrl(v), "Enter a full web address starting with http:// or https://."),
});
type FormValues = z.infer<typeof schema>;

export function NewItemForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", price: "", quantity: "1", categoryId: "", barcode: "", imageUrl: "" },
  });
  const { register, handleSubmit, setValue, setError, control, formState } = form;
  const { errors } = formState;
  const imageUrl = useWatch({ control, name: "imageUrl" });

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
        setError("barcode", { message: "An item with that barcode already exists." });
      } else if (error instanceof ApiError && error.status === 400 && /barcode/i.test(error.message)) {
        setError("barcode", { message: error.message });
      } else {
        setSubmitError(error instanceof Error ? error.message : "Couldn't create the item. Try again.");
      }
    },
  });

  async function upload(file: File) {
    setUploadError(null);
    if (!file.type.startsWith("image/")) return setUploadError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setUploadError("That image is over 10 MB. Choose a smaller one.");

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { imageUrl: uploaded } = await apiFetch<{ imageUrl: string }>("gateway", "images", { method: "POST", body });
      setValue("imageUrl", uploaded, { shouldValidate: true });
    } catch (error) {
      // 502 with "not configured" is the expected state until Cloudflare credentials exist;
      // it isn't a failure of this upload, so say what to do instead.
      const notConfigured = error instanceof ApiError && error.status === 502 && /not configured/i.test(error.message);
      setUploadError(
        notConfigured
          ? "Image uploads aren't set up on this server yet. Paste an image address instead."
          : error instanceof Error
            ? error.message
            : "The upload failed. Try again.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

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
        <FormField id="name" label="Name" error={errors.name?.message}>
          <Input id="name" autoComplete="off" aria-invalid={!!errors.name} aria-describedby="name-msg" className="h-11" {...register("name")} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="price" label="Price" error={errors.price?.message}>
            <Input id="price" inputMode="decimal" placeholder="0.00" autoComplete="off" aria-invalid={!!errors.price} aria-describedby="price-msg" className="h-11" {...register("price")} />
          </FormField>
          <FormField id="quantity" label="Starting stock" error={errors.quantity?.message} hint="How many you're adding to stock now.">
            <Input id="quantity" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.quantity} aria-describedby="quantity-msg" className="h-11" {...register("quantity")} />
          </FormField>
        </div>

        <FormField
          id="categoryId"
          label="Category"
          hint={categories.isError ? "Couldn't load categories. You can still create the item without one." : "Optional."}
        >
          <NativeSelect id="categoryId" aria-describedby="categoryId-msg" {...register("categoryId")}>
            <option value="">No category</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField
          id="barcode"
          label="Barcode"
          error={errors.barcode?.message}
          hint="Leave empty to generate one. If the product already has a barcode, enter it exactly as printed."
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
            Create item
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={() => router.push("/catalog")} disabled={create.isPending}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <FormField id="imageUrl" label="Image" error={errors.imageUrl?.message} hint="Paste an image address, or upload a file.">
          <Input id="imageUrl" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://…" aria-invalid={!!errors.imageUrl} aria-describedby="imageUrl-msg" className="h-11" {...register("imageUrl")} />
        </FormField>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Upload an image file"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="outline" className="h-11 gap-2" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
          {uploading ? "Uploading…" : "Upload a file"}
        </Button>
        {uploadError && (
          <p role="alert" className="text-sm text-destructive">
            {uploadError}
          </p>
        )}

        <ItemImage src={imageUrl && isHttpUrl(imageUrl) ? imageUrl : null} alt="Item preview" className="size-40 self-center md:self-start" />
      </div>
    </form>
  );
}
