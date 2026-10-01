import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StockLookup } from "@/components/stock/stock-lookup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stock");
  return { title: t("title") };
}

export default function StockPage() {
  return <StockLookup />;
}
