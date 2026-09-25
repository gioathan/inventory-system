import type { Metadata } from "next";
import { ScanAndSell } from "@/components/scan/scan-and-sell";

export const metadata: Metadata = { title: "Scan & Sell" };

export default function ScanPage() {
  return <ScanAndSell />;
}
