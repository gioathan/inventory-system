"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
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

// Admin-only in the backend, so only call this from admin screens.
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("gateway", "categories"),
  });
}
