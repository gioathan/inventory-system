"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCategoryTree } from "@/hooks/use-items";
import { apiFetch } from "@/lib/api";
import { leafOptions } from "@/lib/categories";
import type { CatalogEntry } from "@/lib/types";

// Files the selected items under one category in a single request. Only categories with no
// sub-categories are offered — the same rule the server enforces.
export function MoveCategoryDialog({
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
  const t = useTranslations("catalog.move");
  const tc = useTranslations("catalog");
  const queryClient = useQueryClient();
  const tree = useCategoryTree();
  const [categoryId, setCategoryId] = useState("");

  const move = useMutation({
    mutationFn: () =>
      apiFetch("gateway", "items/category", {
        method: "POST",
        body: JSON.stringify({ skus: items.map((i) => i.sku), categoryId: categoryId || null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      onDone?.();
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (move.isPending) return;
        if (!next) move.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { count: items.length })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <FormField id="move-category" label={tc("fields.category")}>
          <Combobox
            id="move-category"
            value={categoryId}
            onValueChange={setCategoryId}
            options={[{ value: "", label: tc("fields.noCategory") }, ...leafOptions(tree)]}
          />
        </FormField>
        {move.isError && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {move.error instanceof Error ? move.error.message : t("failed")}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" className="h-10" disabled={move.isPending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-10 gap-2" disabled={move.isPending || items.length === 0} onClick={() => move.mutate()}>
            {move.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("confirm", { count: items.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
