"use client";

import { ClipboardList, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { useCloseSession, useRestockSessions, useSessionReport } from "@/hooks/use-restock-sessions";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import type { RestockSession } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StartSessionDialog } from "./start-session-dialog";

function duration(from: string, to: string | null) {
  const ms = new Date(to ?? Date.now()).getTime() - new Date(from).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `${hours} h`;
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

// Sessions tile the timeline: each one runs from when it started until the next one started (or
// until an admin closed it), and its report covers exactly that period.
export function SessionsView() {
  const sessions = useRestockSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const closeSession = useCloseSession();

  // Numbered oldest-first so "#7" stays #7 as new sessions are added.
  const numbered = useMemo(() => {
    const list = sessions.data ?? [];
    return list.map((s, index) => ({ ...s, number: list.length - index }));
  }, [sessions.data]);
  const current = numbered.find((s) => s.closedAt === null) ?? null;
  const selected = numbered.find((s) => s.id === selectedId) ?? numbered[0] ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Restock sessions</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A session is one restocking period. Starting a new one ends the previous one, and everything received or sold in
            between is counted in that session&apos;s report.
          </p>
        </div>
        <Button type="button" className="h-10 gap-2" onClick={() => setStartOpen(true)}>
          <Plus className="size-4" />
          {current ? "Start new session" : "Start session"}
        </Button>
      </div>

      {sessions.isPending ? (
        <div className="h-48 animate-pulse rounded-2xl border bg-muted/40" aria-label="Loading sessions" />
      ) : sessions.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load sessions: {sessions.error.message}
        </p>
      ) : numbered.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <ClipboardList className="size-8 text-primary/70" />
          No restock sessions yet. Start one when a delivery comes in.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ul aria-label="Sessions" className="flex flex-col gap-2">
            {numbered.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === session.id}
                  onClick={() => setSelectedId(session.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50",
                    selected?.id === session.id && "border-primary ring-1 ring-primary",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Session #{session.number}</span>
                    {session.closedAt === null ? <StatusPill tone="success">Open</StatusPill> : <StatusPill tone="neutral">Closed</StatusPill>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(session.openedAt)} · {duration(session.openedAt, session.closedAt)}
                  </span>
                  {session.note && <span className="truncate text-xs">{session.note}</span>}
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <SessionReport
              session={selected}
              number={selected.number}
              onClose={selected.closedAt === null ? () => setCloseOpen(true) : undefined}
            />
          )}
        </div>
      )}

      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} current={current} onStarted={({ opened }) => setSelectedId(opened.id)} />

      {current && (
        <ConfirmDialog
          open={closeOpen}
          onOpenChange={(next) => {
            setCloseOpen(next);
            if (!next) closeSession.reset();
          }}
          title={`Close session #${current.number}?`}
          description="Receives from now on won't belong to any session until a new one starts. Its report stops counting at this moment."
          confirmLabel="Close session"
          pending={closeSession.isPending}
          error={closeSession.error?.message}
          onConfirm={() => closeSession.mutate(current.id, { onSuccess: () => setCloseOpen(false) })}
        />
      )}
    </div>
  );
}

function SessionReport({ session, number, onClose }: { session: RestockSession; number: number; onClose?: () => void }) {
  const report = useSessionReport(session.id);

  const lines = useMemo(
    () => [...(report.data ?? [])].sort((a, b) => b.restocked - a.restocked || b.sold - a.sold || (a.name ?? a.sku).localeCompare(b.name ?? b.sku)),
    [report.data],
  );
  const totals = useMemo(
    () =>
      lines.reduce(
        (t, l) => ({
          restocked: t.restocked + l.restocked,
          sold: t.sold + l.sold,
          revenue: t.revenue + (l.revenue ?? 0),
          estimated: t.estimated || l.revenueEstimated,
        }),
        { restocked: 0, sold: 0, revenue: 0, estimated: false },
      ),
    [lines],
  );

  return (
    <section aria-label={`Session #${number} report`} className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Session #{number}</h2>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.openedAt)} → {session.closedAt ? formatDateTime(session.closedAt) : "now (still open)"}
          </p>
          {session.note && <p className="text-sm">{session.note}</p>}
        </div>
        {onClose && (
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            Close session
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          { label: "Received", value: totals.restocked.toLocaleString() },
          { label: "Sold", value: totals.sold.toLocaleString() },
          { label: "Revenue", value: `${totals.estimated ? "≈ " : ""}${formatMoney(totals.revenue)}` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border px-3 py-2.5">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{report.isPending ? "…" : stat.value}</dd>
          </div>
        ))}
      </dl>

      {report.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading report…
        </div>
      ) : report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this report: {report.error.message}
        </p>
      ) : lines.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing was received or sold during this session.
        </p>
      ) : (
        // Scrolls sideways on phones, so it must be reachable by keyboard (tabIndex + a name).
        <div
          tabIndex={0}
          role="region"
          aria-label={`Session #${number} items`}
          className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Start</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Sold</th>
                <th className="px-3 py-2 text-right font-medium">End</th>
                <th className="py-2 pl-3 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line) => (
                <tr key={line.sku}>
                  <td className="max-w-56 py-2.5 pr-3">
                    <div className="truncate font-medium">{line.name ?? "Removed item"}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{line.sku}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{line.openingQuantity}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">+{line.restocked}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">−{line.sold}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium tabular-nums", line.closingQuantity === 0 && "text-destructive")}>
                    {line.closingQuantity}
                  </td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">
                    {line.revenue === null ? "—" : `${line.revenueEstimated ? "≈ " : ""}${formatMoney(line.revenue)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Revenue is what customers paid at each sale.
        {totals.estimated && " ≈ marks items with sales from before prices were recorded, valued at today's price."}
      </p>
    </section>
  );
}
