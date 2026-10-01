import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DiscountsView } from "@/components/catalog/discounts-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("discounts");
  return { title: t("title") };
}

export default function DiscountsPage() {
  return <DiscountsView />;
}
