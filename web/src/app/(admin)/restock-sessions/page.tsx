import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RESTOCK_TABS, RestockPage, type RestockTab } from "@/components/restock/restock-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("restock");
  return { title: t("metaTitle") };
}

export default async function RestockSessionsPage({ searchParams }: PageProps<"/restock-sessions">) {
  const { tab } = await searchParams;
  const valid = RESTOCK_TABS.find((t) => t.id === tab)?.id ?? "sessions";
  return <RestockPage tab={valid as RestockTab} />;
}
