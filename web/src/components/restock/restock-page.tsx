import Link from "next/link";
import { cn } from "@/lib/utils";
import { CompareView } from "./compare-view";
import { SessionsView } from "./sessions-view";

export const RESTOCK_TABS = [
  { id: "sessions", label: "Sessions" },
  { id: "compare", label: "Compare" },
] as const;
export type RestockTab = (typeof RESTOCK_TABS)[number]["id"];

export function RestockPage({ tab }: { tab: RestockTab }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Restock sessions</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A session is one restocking period. Starting a new one ends the previous one, and everything received or sold in
          between is counted in that session.
        </p>
      </div>

      <nav aria-label="Restock sessions views" className="-mb-2 flex gap-1 border-b">
        {RESTOCK_TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "sessions" ? "/restock-sessions" : `/restock-sessions?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "compare" ? <CompareView /> : <SessionsView />}
    </div>
  );
}
