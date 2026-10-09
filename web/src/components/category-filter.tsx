"use client";

import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import type { CategoryTree } from "@/lib/categories";

// "All categories" plus the whole tree, children indented under their parent. Picking a parent
// means everything beneath it too — the screens using this filter with tree.withDescendants.
// Non-breaking spaces do the indenting: a native <option> can't be styled, and ordinary leading
// spaces are collapsed.
export function CategoryFilter({
  tree,
  value,
  onChange,
  counts,
  className,
}: {
  tree: CategoryTree;
  /** A category id, or "" for all. */
  value: string;
  onChange: (categoryId: string) => void;
  /** Shown after each name when given: items in that category including its sub-categories. */
  counts?: (categoryId: string) => number;
  className?: string;
}) {
  const t = useTranslations("common");
  if (tree.all.length === 0) return null;
  return (
    <NativeSelect aria-label={t("categoryFilter.label")} value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      <option value="">{t("categoryFilter.all")}</option>
      {tree.nested.map(({ category, depth }) => (
        <option key={category.id} value={category.id}>
          {"   ".repeat(depth)}
          {category.name}
          {counts ? ` (${counts(category.id)})` : ""}
        </option>
      ))}
    </NativeSelect>
  );
}
