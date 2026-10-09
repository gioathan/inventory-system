"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { buildCategoryTree } from "@/lib/categories";
import { gql } from "@/lib/graphql";
import type { CatalogEntry, Category } from "@/lib/types";

const ITEMS_QUERY = /* GraphQL */ `
  query Items {
    items {
      sku
      name
      barcode
      price
      discountPercentage
      activeDiscountPercentage
      datedDiscountName
      effectivePrice
      imageUrl
      categoryId
      quantityOnHand
    }
  }
`;

// One shared cache entry for every screen that lists items (Stock, Catalog, Discounts, label
// printing). Anything that changes stock or prices invalidates ["items"].
export function useItems() {
  return useQuery({
    queryKey: ["items"],
    queryFn: async () => (await gql<{ items: CatalogEntry[] }>(ITEMS_QUERY)).items,
  });
}

// Readable by sellers too (the Stock screen filters by category); changing them is admin-only.
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("gateway", "categories"),
  });
}

const NO_CATEGORIES: Category[] = [];

// The categories as a tree (see lib/categories.ts). Empty while loading or on error, so callers
// can filter and label without special-casing either.
export function useCategoryTree() {
  const categories = useCategories();
  return useMemo(() => buildCategoryTree(categories.data ?? NO_CATEGORIES), [categories.data]);
}
