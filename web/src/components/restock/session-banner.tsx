"use client";

import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCurrentSession } from "@/hooks/use-restock-sessions";
import { formatDateTime, timeAgo } from "@/lib/time";
import { StartSessionDialog } from "./start-session-dialog";

// Tells whoever is receiving which restock session their scans are logged to. Receiving works
// the same with or without one; a session only groups receives (and sales) for reporting.
export function SessionBanner({ isAdmin }: { isAdmin: boolean }) {
  const current = useCurrentSession();
  const [startOpen, setStartOpen] = useState(false);

  if (current.isPending) return <div className="h-14 animate-pulse rounded-xl border bg-muted/40" aria-label="Loading restock session" />;
  if (current.isError) return null; // receiving still works; don't block the screen on this

  const session = current.data;

  return (
    <section
      aria-label="Restock session"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 items-center gap-3">
        <ClipboardList className="size-5 shrink-0 text-primary" aria-hidden />
        {session ? (
          <div className="min-w-0">
            <div className="font-medium">
              Restock session open{session.note ? ` · ${session.note}` : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              Since {formatDateTime(session.openedAt)} ({timeAgo(session.openedAt)}). Everything you receive is logged to it.
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="font-medium">No restock session open</div>
            <div className="text-xs text-muted-foreground">
              {isAdmin ? "Start one to group this delivery's receives for reporting." : "Receives still count; an admin can start a session to group them."}
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-2">
          <Link href="/restock-sessions" className="self-center px-2 text-xs text-primary hover:underline">
            All sessions
          </Link>
          <Button type="button" variant={session ? "outline" : "default"} className="h-9" onClick={() => setStartOpen(true)}>
            {session ? "Start new session" : "Start session"}
          </Button>
        </div>
      )}

      {isAdmin && <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} current={session} />}
    </section>
  );
}
