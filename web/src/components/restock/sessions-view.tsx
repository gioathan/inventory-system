"use client";

import { ClipboardList, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { useCloseSession, useRestockSessions } from "@/hooks/use-restock-sessions";
import { numberSessions } from "@/lib/restock";
import { useTimeFormat } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SessionReport } from "./session-report";
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
              key={selected.id}
              session={selected}
              previous={numbered.find((s) => s.number === selected.number - 1) ?? null}
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
