import type { Metadata } from "next";
import { RESTOCK_TABS, RestockPage, type RestockTab } from "@/components/restock/restock-page";

export const metadata: Metadata = { title: "Restock sessions" };

export default async function RestockSessionsPage({ searchParams }: PageProps<"/restock-sessions">) {
  const { tab } = await searchParams;
  const valid = RESTOCK_TABS.find((t) => t.id === tab)?.id ?? "sessions";
  return <RestockPage tab={valid as RestockTab} />;
}
