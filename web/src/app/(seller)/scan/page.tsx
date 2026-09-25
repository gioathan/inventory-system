import type { Metadata } from "next";

export const metadata: Metadata = { title: "Scan & Sell" };

export default function ScanPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Scan &amp; Sell</h1>
      <p className="text-sm text-muted-foreground">The scanner arrives in Phase 1.</p>
    </div>
  );
}
