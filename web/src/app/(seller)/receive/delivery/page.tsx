import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DeliveryWorksheet } from "@/components/receive/delivery-worksheet";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("receive.delivery");
  return { title: t("title") };
}

export default async function DeliveryPage() {
  // The layout has already redirected signed-out users; role only decides whether the session
  // banner offers "Start session" (the backend enforces admin-only regardless).
  const session = await getSession();
  return <DeliveryWorksheet isAdmin={session?.role === "Admin"} />;
}
