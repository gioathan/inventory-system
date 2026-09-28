import type { Metadata } from "next";
import { BulkAddView } from "@/components/catalog/bulk-add-view";

export const metadata: Metadata = { title: "Add multiple items" };

export default function BulkAddPage() {
  return <BulkAddView />;
}
