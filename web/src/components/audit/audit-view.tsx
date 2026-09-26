"use client";

import { Loader2, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { FilterChips } from "@/components/filter-chips";
import { StatusPill, type PillTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuditLog } from "@/hooks/use-admin-data";
import { formatDateTime } from "@/lib/time";

const PAGE = 25;

// A failed sign-in is the entry an admin most needs to notice, so it stands out; unknown actions
// (anything the backend starts recording later) fall back to neutral.
const TONE: Record<string, PillTone> = { LoginFailed: "danger", UserCreated: "info", LoginSucceeded: "neutral" };

// "UserCreated" -> "User created". New action names the backend starts recording read sensibly
// without a code change here.
const label = (action: string) => action.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (m) => m.toLowerCase());
const detail = (details: string | null) => (details ? details.replace(/=/g, ": ").replace(/;\s*/g, " · ") : "—");

export function AuditView() {
  const log = useAuditLog();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const all = useMemo(() => log.data ?? [], [log.data]);

  // Built from what's actually in the log rather than a fixed list.
  const options = useMemo(() => {
    const actions = [...new Set(all.map((e) => e.action))].sort();
    return [{ id: "all", label: "All" }, ...actions.map((a) => ({ id: a, label: label(a) }))];
  }, [all]);
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
  }, [all, filter, search]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Sign-ins (successful and failed) and staff account creation, newest first. Sales, price and stock
          changes aren&apos;t tracked here yet.
        </p>
      </div>

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setShown(PAGE);
          }}
          aria-label="Search the audit log"
          placeholder="Search by person, action or detail"
          autoComplete="off"
          className="h-11 pl-9 pr-10"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
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
        <div className="flex flex-col gap-2" aria-label="Loading the audit log">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : log.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">Couldn&apos;t load the audit log: {log.error.message}</p>
          <Button type="button" variant="outline" onClick={() => log.refetch()}>
            {log.isFetching && <Loader2 className="size-4 animate-spin" />}
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {all.length === 0 ? "Nothing has been recorded yet." : "No entries match. Try a different search or filter."}
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? "entry" : "entries"}
            {all.length >= 200 && " (the most recent 200 are kept)"}
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
              Show more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
