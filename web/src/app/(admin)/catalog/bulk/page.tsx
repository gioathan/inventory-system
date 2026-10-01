import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BulkAddView } from "@/components/catalog/bulk-add-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("catalog");
  return { title: t("meta.bulkTitle") };
}

export default function BulkAddPage() {
  return <BulkAddView />;
}
