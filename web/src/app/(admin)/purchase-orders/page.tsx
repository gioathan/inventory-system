import type { Metadata } from "next";
import { PoList } from "@/components/po/po-list";

export const metadata: Metadata = { title: "Purchase orders" };

export default function PurchaseOrdersPage() {
  return <PoList />;
}
