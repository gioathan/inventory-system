import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PrintLabels } from "@/components/labels/print-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("labels");
  return { title: t("title") };
}

// Capped so a hand-edited URL can't ask the browser to lay out an absurd number of labels.
const MAX_SKUS = 500;

export default async function PrintLabelsPage({ searchParams }: PageProps<"/labels/print">) {
  const { sku } = await searchParams;
  const skus = (Array.isArray(sku) ? sku : sku ? [sku] : []).slice(0, MAX_SKUS);
  return <PrintLabels skus={skus} />;
}
