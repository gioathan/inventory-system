import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PoDetail } from "@/components/po/po-detail";

export const metadata: Metadata = { title: "Purchase order" };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  const { id } = await params;
  // A malformed id can never match an order; answer 404 here rather than calling the backend
  // with junk in the URL.
  if (!GUID.test(id)) notFound();
  return <PoDetail id={id} />;
}
