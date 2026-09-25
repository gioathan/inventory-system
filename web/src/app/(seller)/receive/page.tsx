import type { Metadata } from "next";
import { ReceiveStock } from "@/components/receive/receive-stock";

export const metadata: Metadata = { title: "Receive stock" };

export default async function ReceivePage({ searchParams }: PageProps<"/receive">) {
  const { barcode } = await searchParams;
  return <ReceiveStock initialCode={typeof barcode === "string" ? barcode : undefined} />;
}
