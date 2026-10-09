"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FolderInput, FolderPlus, Loader2, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/checkbox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField } from "@/components/form-field";
import { NoticeBanner } from "@/components/notice-banner";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useCategories, useCategoryTree, useItems } from "@/hooks/use-items";
import type { Notice } from "@/hooks/use-item-lookup";
import { ApiError, apiFetch } from "@/lib/api";
import { countItems, PATH_SEPARATOR, type CategoryTree } from "@/lib/categories";
import { formatMoney } from "@/lib/format";
import type { Category } from "@/lib/types";

// Long enough for any real category; past it the list points at Items & SKUs, which can search.
const MAX_ITEMS_SHOWN = 200;

// Browsed one level at a time: the top-level categories first, then into one to see what's
// inside it, with a trail back up. Which category you're inside lives in the URL (?in=), so the
// back button and a shared link both work — and the add box always adds to the level on screen,
// which is what makes it clear where a new category will land.
export function CategoriesView() {
  const t = useTranslations("categories");
  const queryClient = useQueryClient();
  const categories = useCategories();
  const tree = useCategoryTree();
  const items = useItems();
  const inside = useSearchParams().get("in");
  const current = inside ? tree.get(inside) : undefined;

  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<"rename" | "move" | "delete" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const counts = useMemo(() => countItems(tree, items.data ?? []), [tree, items.data]);
  const rows = tree.childrenOf(current?.id ?? null);
  const trail = current ? tree.path(current.id) : [];

  const create = useMutation({
    mutationFn: (categoryName: string) =>
      apiFetch<Category>("gateway", "categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName, parentId: current?.id ?? null }),
      }),
    onSuccess: () => {
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? t("duplicate") : e instanceof Error ? e.message : t("addFailed")),
  });

  const remove = useMutation({
    mutationFn: (category: Category) => apiFetch<void>("gateway", `categories/${category.id}`, { method: "DELETE" }),
    onSuccess: (_, category) => {
      setEditing(null);
      setNotice({ kind: "success", text: t("delete.done", { name: category.name }) });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      // It no longer exists, so step out to where it was.
      router.replace(category.parentId ? `/categories?in=${category.parentId}` : "/categories");
    },
  });

  const trimmed = name.trim();
  const within = current ? tree.withDescendants(current.id) : null;
  const inCategory = within
    ? (items.data ?? []).filter((i) => i.categoryId !== null && within.has(i.categoryId)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  // Items filed straight under a category that has sub-categories: still counted and shown
  // under it everywhere, but waiting for someone to say which sub-category they belong in.
  const unsorted =
    current && rows.length > 0
      ? (items.data ?? []).filter((i) => i.categoryId === current.id).sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        {current && (
          <nav aria-label={t("trailLabel")} className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Link href="/categories" className="rounded hover:text-foreground hover:underline">
              {t("allCategories")}
            </Link>
            {trail.map((category, index) => (
              <span key={category.id} className="flex items-center gap-1">
                <ChevronRight aria-hidden className="size-3.5" />
                {index === trail.length - 1 ? (
                  <span aria-current="page" className="font-medium text-foreground">
                    {category.name}
                  </span>
                ) : (
                  <Link href={`/categories?in=${category.id}`} className="rounded hover:text-foreground hover:underline">
                    {category.name}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{current ? current.name : t("title")}</h1>
          {current && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-9 gap-2" onClick={() => setEditing("rename")}>
                <Pencil className="size-4" />
                {t("rename.action")}
              </Button>
              <Button type="button" variant="outline" className="h-9 gap-2" onClick={() => setEditing("move")}>
                <FolderInput className="size-4" />
                {t("move.action")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2"
                onClick={() => {
                  remove.reset();
                  setEditing("delete");
                }}
              >
                <Trash2 className="size-4" />
                {t("delete.action")}
              </Button>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {current ? t("insideSummary", { items: counts.total(current.id), subcategories: rows.length }) : t("subtitle")}
          {current && counts.total(current.id) > 0 && (
            <>
              {" "}
              <Link href={`/catalog?category=${current.id}`} className="font-medium text-foreground underline underline-offset-2">
                {t("viewItems")}
              </Link>
            </>
          )}
        </p>
      </div>

      {notice && <NoticeBanner notice={notice} />}

      <form
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) create.mutate(trimmed);
        }}
      >
        <FormField
          id="category-name"
          label={current ? t("addInside", { name: current.name }) : t("addTopLevel")}
          error={error ?? undefined}
          className="flex-1"
        >
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

      {current && unsorted.length > 0 && (
        <SortItems key={current.id} category={current} items={unsorted} targets={tree.leaves.filter((c) => c.id !== current.id && tree.withDescendants(current.id).has(c.id))} pathLabel={tree.pathLabel} />
      )}

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
      ) : rows.length === 0 ? (
        // A category with items but no sub-categories isn't empty: its items are listed below.
        inCategory.length > 0 ? null : (
          <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {current ? t("emptyInside", { name: current.name }) : t("empty")}
          </div>
        )
      ) : (
        <ul aria-label={current ? t("subcategoriesOf", { name: current.name }) : t("title")} className="divide-y rounded-2xl border bg-card">
          {rows.map((category) => {
            const kids = tree.childrenOf(category.id).length;
            const waiting = kids > 0 ? counts.direct(category.id) : 0;
            return (
              <li key={category.id}>
                <Link
                  href={`/categories?in=${category.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{category.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {kids > 0 ? `${t("subcategoryCount", { count: kids })} · ` : ""}
                      {t("itemCount", { count: counts.total(category.id) })}
                    </span>
                  </span>
                  {waiting > 0 && <StatusPill tone="warning">{t("toSort", { count: waiting })}</StatusPill>}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Everything filed under this category, its sub-categories' items included — the same
          roll-up the filters use. Each row opens the item in Items & SKUs. */}
      {current && inCategory.length > 0 && (
        <section aria-labelledby="category-items" className="flex flex-col gap-2">
          <h2 id="category-items" className="text-sm font-medium">
            {t("itemsIn", { name: current.name, count: inCategory.length })}
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {inCategory.slice(0, MAX_ITEMS_SHOWN).map((item) => {
              // Where under this category it sits, when that's deeper than the category itself.
              const below = item.categoryId && item.categoryId !== current.id
                ? tree.path(item.categoryId).slice(trail.length).map((c) => c.name).join(PATH_SEPARATOR)
                : "";
              return (
                <li key={item.sku}>
                  <Link
                    href={`/catalog?sku=${encodeURIComponent(item.sku)}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      {below && <span className="block truncate text-xs text-muted-foreground">{below}</span>}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatMoney(item.effectivePrice)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {inCategory.length > MAX_ITEMS_SHOWN && (
            <p className="text-xs text-muted-foreground">
              {t("itemsMore", { shown: MAX_ITEMS_SHOWN })}{" "}
              <Link href={`/catalog?category=${current.id}`} className="font-medium text-foreground underline underline-offset-2">
                {t("viewItems")}
              </Link>
            </p>
          )}
        </section>
      )}

      {current && (
        <>
          <RenameDialog
            key={`rename-${current.id}-${current.name}`}
            open={editing === "rename"}
            onOpenChange={(open) => !open && setEditing(null)}
            category={current}
            onDone={(renamed) => setNotice({ kind: "success", text: t("rename.done", { name: renamed.name }) })}
          />
          <MoveDialog
            key={`move-${current.id}-${current.parentId ?? "top"}`}
            open={editing === "move"}
            onOpenChange={(open) => !open && setEditing(null)}
            category={current}
            tree={tree}
            directItems={counts.direct}
            onDone={(destination) =>
              setNotice({ kind: "success", text: destination ? t("move.done", { name: current.name, parent: destination.name }) : t("move.doneTop", { name: current.name }) })
            }
          />
          {/* Deleting is only possible once nothing depends on the category, so when something
              does, the dialog says what — instead of offering a button the server would refuse. */}
          <ConfirmDialog
            open={editing === "delete"}
            onOpenChange={(open) => !open && setEditing(null)}
            title={t("delete.title", { name: current.name })}
            description={
              rows.length > 0
                ? t("delete.hasSubcategories", { count: rows.length })
                : counts.direct(current.id) > 0
                  ? t("delete.hasItems", { count: counts.direct(current.id) })
                  : t("delete.description")
            }
            confirmLabel={t("delete.confirm")}
            destructive
            pending={remove.isPending}
            confirmDisabled={rows.length > 0 || counts.direct(current.id) > 0}
            error={remove.isError ? (remove.error instanceof Error ? remove.error.message : t("delete.failed")) : null}
            onConfirm={() => remove.mutate(current)}
          />
        </>
      )}
    </div>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  category,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category;
  onDone: (renamed: Category) => void;
}) {
  const t = useTranslations("categories");
  const queryClient = useQueryClient();
  const [name, setName] = useState(category.name);
  const trimmed = name.trim();

  const rename = useMutation({
    mutationFn: () => apiFetch<Category>("gateway", `categories/${category.id}/rename`, { method: "POST", body: JSON.stringify({ name: trimmed }) }),
    onSuccess: (renamed) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      onDone(renamed);
      onOpenChange(false);
    },
  });
  const error = rename.isError ? (rename.error instanceof ApiError && rename.error.status === 409 ? t("duplicate") : rename.error instanceof Error ? rename.error.message : t("rename.failed")) : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => !rename.isPending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed && trimmed !== category.name) rename.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("rename.title", { name: category.name })}</DialogTitle>
            <DialogDescription>{t("rename.description")}</DialogDescription>
          </DialogHeader>
          <FormField id="rename-category" label={t("rename.label")} error={error}>
            <Input
              id="rename-category"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              autoComplete="off"
              aria-describedby="rename-category-msg"
              className="h-11"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" className="h-10" disabled={rename.isPending} onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-10 gap-2" disabled={!trimmed || trimmed === category.name || rename.isPending}>
              {rename.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("rename.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Offers every place the category could go: the top level, or inside any category that isn't
// itself or beneath it (moving it there would loop the chain — the server refuses that too).
function MoveDialog({
  open,
  onOpenChange,
  category,
  tree,
  directItems,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category;
  tree: CategoryTree;
  directItems: (id: string) => number;
  onDone: (destination: Category | undefined) => void;
}) {
  const t = useTranslations("categories");
  const queryClient = useQueryClient();
  const [parentId, setParentId] = useState(category.parentId ?? "");
  const own = tree.withDescendants(category.id);
  const destination = parentId ? tree.get(parentId) : undefined;
  // Moving into a category that holds items of its own turns those into "to sort".
  const displaced = destination && !tree.hasChildren(destination.id) ? directItems(destination.id) : 0;

  const move = useMutation({
    mutationFn: () => apiFetch<Category>("gateway", `categories/${category.id}/move`, { method: "POST", body: JSON.stringify({ parentId: parentId || null }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      onDone(destination);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !move.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("move.title", { name: category.name })}</DialogTitle>
          <DialogDescription>{t("move.description")}</DialogDescription>
        </DialogHeader>
        <FormField id="move-parent" label={t("move.label")} hint={displaced > 0 ? t("move.displaces", { count: displaced, name: destination?.name ?? "" }) : undefined}>
          <NativeSelect id="move-parent" value={parentId} onChange={(event) => setParentId(event.target.value)} aria-describedby="move-parent-msg">
            <option value="">{t("move.topLevel")}</option>
            {tree.nested
              .filter(({ category: c }) => !own.has(c.id))
              .map(({ category: c, depth }) => (
                <option key={c.id} value={c.id}>
                  {"\u00A0\u00A0\u00A0".repeat(depth)}
                  {c.name}
                </option>
              ))}
          </NativeSelect>
        </FormField>
        {move.isError && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {move.error instanceof Error ? move.error.message : t("move.failed")}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" className="h-10" disabled={move.isPending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-10 gap-2" disabled={parentId === (category.parentId ?? "") || move.isPending} onClick={() => move.mutate()}>
            {move.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shown inside a category that has both sub-categories and items of its own. Tick a batch, pick
// where they go, move; repeat until the list is empty.
function SortItems({
  category,
  items,
  targets,
  pathLabel,
}: {
  category: Category;
  items: { sku: string; name: string; barcode: string }[];
  targets: Category[];
  pathLabel: (id: string) => string;
}) {
  const t = useTranslations("categories");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  // Only skus still in the list: after a move, the moved ones are gone from `items`.
  const chosen = items.filter((i) => selected.has(i.sku)).map((i) => i.sku);
  const destination = targets.find((c) => c.id === target) ?? (targets.length === 1 ? targets[0] : undefined);

  const move = useMutation({
    mutationFn: (to: Category) =>
      apiFetch<{ moved: number }>("gateway", "items/category", { method: "POST", body: JSON.stringify({ skus: chosen, categoryId: to.id }) }),
    onSuccess: ({ moved }, to) => {
      setSelected(new Set());
      setNotice({ kind: "success", text: t("sort.moved", { count: moved, name: to.name }) });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : t("sort.failed") }),
  });

  const allSelected = chosen.length === items.length;
  const toggle = (sku: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(sku)) next.add(sku);
      return next;
    });

  return (
    <section aria-labelledby="sort-heading" className="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-4">
      <div className="flex flex-col gap-1">
        <h2 id="sort-heading" className="text-sm font-semibold">
          {t("sort.title", { count: items.length })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("sort.explanation", { name: category.name })}</p>
      </div>

      {notice && <NoticeBanner notice={notice} />}

      <div className="flex flex-wrap items-end gap-3">
        <FormField id="sort-target" label={t("sort.moveTo")} className="min-w-48 flex-1">
          <NativeSelect id="sort-target" value={destination?.id ?? ""} onChange={(event) => setTarget(event.target.value)}>
            {targets.length !== 1 && <option value="">{t("sort.choose")}</option>}
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                {pathLabel(c.id)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="button" className="h-11 gap-2" disabled={chosen.length === 0 || !destination || move.isPending} onClick={() => destination && move.mutate(destination)}>
          {move.isPending && <Loader2 className="size-4 animate-spin" />}
          {t("sort.move", { count: chosen.length })}
        </Button>
      </div>

      <ul className="divide-y rounded-xl border bg-card">
        <li className="flex items-center gap-3 px-4 py-2.5">
          <Checkbox
            id="sort-all"
            checked={allSelected}
            indeterminate={chosen.length > 0 && !allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.sku)))}
          />
          <label htmlFor="sort-all" className="cursor-pointer text-sm font-medium">
            {t("sort.selectAll")}
          </label>
        </li>
        {items.map((item) => (
          <li key={item.sku} className="flex items-center gap-3 px-4 py-2.5">
            <Checkbox id={`sort-${item.sku}`} checked={selected.has(item.sku)} onChange={() => toggle(item.sku)} />
            <label htmlFor={`sort-${item.sku}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="block truncate text-sm">{item.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{item.barcode}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
