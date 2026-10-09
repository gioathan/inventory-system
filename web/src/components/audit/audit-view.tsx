"use client";

import { Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { FilterChips } from "@/components/filter-chips";
import { StatusPill, type PillTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuditLog } from "@/hooks/use-admin-data";
import { useTimeFormat } from "@/lib/time";

const PAGE = 25;

// A failed sign-in is the entry an admin most needs to notice, so it stands out; unknown actions
// (anything the backend starts recording later) fall back to neutral.
const TONE: Record<string, PillTone> = { LoginFailed: "danger", UserCreated: "info", UserDeleted: "warning", LoginSucceeded: "neutral" };

// Actions with a translated label (audit.json "actions"); anything else falls back to humanize().
const KNOWN_ACTIONS = ["LoginFailed", "LoginSucceeded", "UserCreated", "UserDeleted"] as const;
type KnownAction = (typeof KNOWN_ACTIONS)[number];
const isKnownAction = (action: string): action is KnownAction => (KNOWN_ACTIONS as readonly string[]).includes(action);

// "UserCreated" -> "User created". New action names the backend starts recording read sensibly
// without a code change here (in English only, until they're added to KNOWN_ACTIONS).
const humanize = (action: string) => action.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (m) => m.toLowerCase());
const detail = (details: string | null) => (details ? details.replace(/=/g, ": ").replace(/;\s*/g, " · ") : "—");

export function AuditView() {
  const t = useTranslations("audit");
  const { formatDateTime } = useTimeFormat();
  const label = useCallback((action: string) => (isKnownAction(action) ? t(`actions.${action}`) : humanize(action)), [t]);
  const log = useAuditLog();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const all = useMemo(() => log.data ?? [], [log.data]);

  // Built from what's actually in the log rather than a fixed list.
  const options = useMemo(() => {
    const actions = [...new Set(all.map((e) => e.action))].sort();
    return [{ id: "all", label: t("all") }, ...actions.map((a) => ({ id: a, label: label(a) }))];
  }, [all, label, t]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: all.length };
    for (const entry of all) result[entry.action] = (result[entry.action] ?? 0) + 1;
    return result;
  }, [all]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((e) => filter === "all" || e.action === filter)
      .filter((e) => !term || [e.username, e.action, label(e.action), e.details ?? ""].some((f) => f.toLowerCase().includes(term)));
  }, [all, filter, search, label]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setShown(PAGE);
          }}
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          className="h-11 pl-9 pr-10"
        />
        {search && (
          <button
            type="button"
            aria-label={t("clearSearch")}
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {options.length > 2 && (
        <FilterChips
          options={options}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setShown(PAGE);
          }}
          counts={counts}
        />
      )}

      {log.isPending ? (
        <div className="flex flex-col gap-2" aria-label={t("loading")}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : log.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">{t("loadError", { message: log.error.message })}</p>
          <Button type="button" variant="outline" onClick={() => log.refetch()}>
            {log.isFetching && <Loader2 className="size-4 animate-spin" />}
            {t("tryAgain")}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {all.length === 0 ? t("emptyLog") : t("noMatches")}
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t("entryCount", { count: visible.length, capped: String(all.length >= 200) })}
          </p>
          <ul className="divide-y rounded-2xl border bg-card">
            {visible.slice(0, shown).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5">
                {/* Fixed width, so the name column starts at the same place on every row whatever the action is called. */}
                <div className="w-36 shrink-0">
                  <StatusPill tone={TONE[entry.action] ?? "neutral"}>{label(entry.action)}</StatusPill>
                </div>
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate text-sm font-medium">{entry.username}</div>
                  <div className="truncate text-xs text-muted-foreground">{detail(entry.details)}</div>
                </div>
                <time dateTime={entry.timestamp} className="text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </time>
              </li>
            ))}
          </ul>
          {visible.length > shown && (
            <Button type="button" variant="outline" className="h-10 self-center" onClick={() => setShown((n) => n + PAGE)}>
              {t("showMore")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
