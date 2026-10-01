"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCategories, useItems } from "@/hooks/use-items";
import { ApiError, apiFetch } from "@/lib/api";
import type { Category } from "@/lib/types";

export function CategoriesView() {
  const t = useTranslations("categories");
  const queryClient = useQueryClient();
  const categories = useCategories();
  const items = useItems();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items.data ?? []) if (item.categoryId) map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    return map;
  }, [items.data]);

  const create = useMutation({
    mutationFn: (categoryName: string) =>
      apiFetch<Category>("gateway", "categories", { method: "POST", body: JSON.stringify({ name: categoryName }) }),
    onSuccess: () => {
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? t("duplicate") : e instanceof Error ? e.message : t("addFailed")),
  });

  const trimmed = name.trim();
  const sorted = [...(categories.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <form
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) create.mutate(trimmed);
        }}
      >
        <FormField id="category-name" label={t("newCategory")} error={error ?? undefined} className="flex-1">
          <Input
            id="category-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            autoComplete="off"
            aria-describedby="category-name-msg"
            className="h-11"
          />
        </FormField>
        <Button type="submit" className="h-11 gap-2 sm:mt-7" disabled={!trimmed || create.isPending}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
          {t("addCategory")}
        </Button>
      </form>

      {categories.isPending ? (
        <div className="flex flex-col gap-2" aria-label={t("loading")}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : categories.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("loadError", { message: categories.error.message })}
        </p>
      ) : sorted.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {sorted.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="font-medium">{category.name}</span>
              <span className="text-sm tabular-nums text-muted-foreground">{t("itemCount", { count: counts.get(category.id) ?? 0 })}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
