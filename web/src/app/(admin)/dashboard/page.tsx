import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
      <p className="text-sm text-muted-foreground">The dashboard arrives in Phase 5.</p>
    </div>
  );
}
