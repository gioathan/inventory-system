import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CategoriesView } from "@/components/catalog/categories-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("categories");
  return { title: t("title") };
}

// CategoriesView reads ?in= (which category you are inside) from the URL, and a component that
// reads search params must sit under a Suspense boundary.
export default function CategoriesPage() {
  return (
    <Suspense>
      <CategoriesView />
    </Suspense>
  );
}
