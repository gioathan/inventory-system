import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CompareView } from "./compare-view";
import { InsightsView } from "./insights-view";
import { SessionsView } from "./sessions-view";

// labelKey indexes into the "restock" messages; resolved below, where translations are available.
export const RESTOCK_TABS = [
  { id: "sessions", labelKey: "page.tabs.sessions" },
  { id: "compare", labelKey: "page.tabs.compare" },
  { id: "insights", labelKey: "page.tabs.insights" },
] as const;
export type RestockTab = (typeof RESTOCK_TABS)[number]["id"];

export async function RestockPage({ tab }: { tab: RestockTab }) {
  const t = await getTranslations("restock");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("page.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("page.intro")}</p>
      </div>

      <nav aria-label={t("page.tabsLabel")} className="-mb-2 flex gap-1 border-b">
        {RESTOCK_TABS.map((tabDef) => (
          <Link
            key={tabDef.id}
            href={tabDef.id === "sessions" ? "/restock-sessions" : `/restock-sessions?tab=${tabDef.id}`}
            aria-current={tab === tabDef.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === tabDef.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tabDef.labelKey)}
          </Link>
        ))}
      </nav>

      {tab === "compare" ? <CompareView /> : tab === "insights" ? <InsightsView /> : <SessionsView />}
    </div>
  );
}
