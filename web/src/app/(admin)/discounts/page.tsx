import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DiscountsView } from "@/components/catalog/discounts-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("discounts");
  return { title: t("title") };
}

// DiscountsView reads ?dated=new&sku=… from the URL, and a component that reads search params
// must sit under a Suspense boundary.
export default function DiscountsPage() {
  return (
    <Suspense>
      <DiscountsView />
    </Suspense>
  );
}
