import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuditView } from "@/components/audit/audit-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

export default function AuditLogPage() {
  return <AuditView />;
}
