"use client";

import { ClipboardList, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { useCloseSession, useRestockSessions, useSessionReport } from "@/hooks/use-restock-sessions";
import { formatMoney } from "@/lib/format";
import { numberSessions } from "@/lib/restock";
import { useTimeFormat } from "@/lib/time";
import type { RestockSession } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StartSessionDialog } from "./start-session-dialog";

type RestockT = ReturnType<typeof useTranslations<"restock">>;

function duration(t: RestockT, from: string, to: string | null) {
  const ms = new Date(to ?? Date.now()).getTime() - new Date(from).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return t("sessions.duration.days", { count: String(Math.floor(hours / 24)) });
  if (hours >= 1) return t("sessions.duration.hours", { count: String(hours) });
  return t("sessions.duration.minutes", { count: String(Math.max(1, Math.round(ms / 60_000))) });
}

// Sessions tile the timeline: each one runs from when it started until the next one started (or
// until an admin closed it), and its report covers exactly that period.
export function SessionsView() {
  const sessions = useRestockSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const closeSession = useCloseSession();
  const t = useTranslations("restock");
  const { formatDateTime } = useTimeFormat();

  const numbered = useMemo(() => numberSessions(sessions.data ?? []), [sessions.data]);
  const current = numbered.find((s) => s.closedAt === null) ?? null;
  const selected = numbered.find((s) => s.id === selectedId) ?? numbered[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {current ? t("sessions.currentOpen", { number: String(current.number) }) : t("sessions.noneOpen")}
        </p>
        <Button type="button" className="h-10 gap-2" onClick={() => setStartOpen(true)}>
          <Plus className="size-4" />
          {current ? t("actions.startNewSession") : t("actions.startSession")}
        </Button>
      </div>

      {sessions.isPending ? (
        <div className="h-48 animate-pulse rounded-2xl border bg-muted/40" aria-label={t("loadingSessions")} />
      ) : sessions.isError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("sessions.loadError", { message: sessions.error.message })}
        </p>
      ) : numbered.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <ClipboardList className="size-8 text-primary/70" />
          {t("sessions.empty")}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ul aria-label={t("sessions.listLabel")} className="flex flex-col gap-2">
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
                    <span className="font-medium">{t("sessions.name", { number: String(session.number) })}</span>
                    {session.closedAt === null ? (
                      <StatusPill tone="success">{t("sessions.open")}</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">{t("sessions.closed")}</StatusPill>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(session.openedAt)} · {duration(t, session.openedAt, session.closedAt)}
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
          title={t("sessions.closeTitle", { number: String(current.number) })}
          description={t("sessions.closeDescription")}
          confirmLabel={t("actions.closeSession")}
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
  const t = useTranslations("restock");
  const { formatDateTime } = useTimeFormat();
  const n = String(number);

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
    <section aria-label={t("report.label", { number: n })} className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("sessions.name", { number: n })}</h2>
          <p className="text-sm text-muted-foreground">
            {t("report.range", {
              from: formatDateTime(session.openedAt),
              to: session.closedAt ? formatDateTime(session.closedAt) : t("report.nowStillOpen"),
            })}
          </p>
          {session.note && <p className="text-sm">{session.note}</p>}
        </div>
        {onClose && (
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            {t("actions.closeSession")}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          { id: "received", label: t("report.received"), value: totals.restocked.toLocaleString() },
          { id: "sold", label: t("report.sold"), value: totals.sold.toLocaleString() },
          { id: "revenue", label: t("report.revenue"), value: `${totals.estimated ? "≈ " : ""}${formatMoney(totals.revenue)}` },
        ].map((stat) => (
          <div key={stat.id} className="rounded-xl border px-3 py-2.5">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{report.isPending ? "…" : stat.value}</dd>
          </div>
        ))}
      </dl>

      {report.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("report.loading")}
        </div>
      ) : report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("report.loadError", { message: report.error.message })}
        </p>
      ) : lines.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t("report.empty")}
        </p>
      ) : (
        // Scrolls sideways on phones, so it must be reachable by keyboard (tabIndex + a name).
        <div
          tabIndex={0}
          role="region"
          aria-label={t("report.itemsLabel", { number: n })}
          className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t("report.columns.item")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("report.columns.start")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("report.columns.received")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("report.columns.sold")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("report.columns.end")}</th>
                <th className="py-2 pl-3 text-right font-medium">{t("report.columns.revenue")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line) => (
                <tr key={line.sku}>
                  <td className="max-w-56 py-2.5 pr-3">
                    <div className="truncate font-medium">{line.name ?? t("report.removedItem")}</div>
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
        {totals.estimated ? t("report.revenueNoteEstimated") : t("report.revenueNote")}
      </p>
    </section>
  );
}
