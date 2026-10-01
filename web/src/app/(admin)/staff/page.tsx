import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StaffView } from "@/components/staff/staff-view";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff");
  return { title: t("title") };
}

export default async function StaffPage() {
  // Read on the server so the list can mark "(you)" without shipping the token's claims around.
  const session = await getSession();
  return <StaffView currentUsername={session?.username ?? ""} />;
}
