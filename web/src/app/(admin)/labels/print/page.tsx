import type { Metadata } from "next";
import { PrintLabels } from "@/components/labels/print-labels";

export const metadata: Metadata = { title: "Print labels" };

// Capped so a hand-edited URL can't ask the browser to lay out an absurd number of labels.
const MAX_SKUS = 500;

export default async function PrintLabelsPage({ searchParams }: PageProps<"/labels/print">) {
  const { sku } = await searchParams;
  const skus = (Array.isArray(sku) ? sku : sku ? [sku] : []).slice(0, MAX_SKUS);
  return <PrintLabels skus={skus} />;
}
