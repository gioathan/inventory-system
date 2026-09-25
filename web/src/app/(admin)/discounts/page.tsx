import type { Metadata } from "next";
import { DiscountsView } from "@/components/catalog/discounts-view";

export const metadata: Metadata = { title: "Discounts & Promos" };

export default function DiscountsPage() {
  return <DiscountsView />;
}
