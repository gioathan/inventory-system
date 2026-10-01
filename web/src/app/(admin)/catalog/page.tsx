import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CatalogView } from "@/components/catalog/catalog-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("catalog");
  return { title: t("meta.catalogTitle") };
}

// CatalogView reads ?sku= from the URL, and a component that reads search params must sit
// under a Suspense boundary so the rest of the page can render without waiting on it.
export default function CatalogPage() {
  return (
    <Suspense>
      <CatalogView />
    </Suspense>
  );
}
