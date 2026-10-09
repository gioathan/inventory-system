import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StockLookup } from "@/components/stock/stock-lookup";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stock");
  return { title: t("title") };
}

export default async function StockPage() {
  // Role only decides whether cards offer "Receive" (the backend enforces admin-only regardless).
  const session = await getSession();
  return <StockLookup canReceive={session?.role === "Admin"} />;
}
