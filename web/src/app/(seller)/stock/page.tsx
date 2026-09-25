import type { Metadata } from "next";
import { StockLookup } from "@/components/stock/stock-lookup";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return <StockLookup />;
}
