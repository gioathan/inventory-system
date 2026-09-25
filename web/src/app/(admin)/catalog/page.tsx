import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogView } from "@/components/catalog/catalog-view";

export const metadata: Metadata = { title: "Items & SKUs" };

// CatalogView reads ?sku= from the URL, and a component that reads search params must sit
// under a Suspense boundary so the rest of the page can render without waiting on it.
export default function CatalogPage() {
  return (
    <Suspense>
      <CatalogView />
    </Suspense>
  );
}
