"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useStartSession } from "@/hooks/use-restock-sessions";
import { formatDateTime } from "@/lib/time";
import type { RestockSession } from "@/lib/types";

// Starting a session closes the open one at the same moment, so the dialog says so up front
// rather than surprising anyone who didn't know a session was running.
export function StartSessionDialog({
  open,
  onOpenChange,
  current,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: RestockSession | null | undefined;
  onStarted?: (result: { opened: RestockSession; closed: RestockSession | null }) => void;
}) {
  const [note, setNote] = useState("");
  const start = useStartSession();
  const tooLong = note.trim().length > 200;

  function close(next: boolean) {
    if (start.isPending) return;
    onOpenChange(next);
    if (!next) {
      setNote("");
      start.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a restock session</DialogTitle>
          <DialogDescription>
            {current
              ? `This ends the session that opened ${formatDateTime(current.openedAt)}. Everything received from now on is logged to the new one.`
              : "Everything received from now on is logged to this session, until the next one starts."}
          </DialogDescription>
        </DialogHeader>

        <FormField id="session-note" label="Note" hint="Optional, e.g. the supplier or delivery." error={tooLong ? "Keep it under 200 characters." : undefined}>
          <Input
            id="session-note"
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby="session-note-msg"
            aria-invalid={tooLong}
            className="h-11"
          />
        </FormField>

        {start.error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {start.error.message}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" className="h-10" disabled={start.isPending} onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-10"
            disabled={start.isPending || tooLong}
            onClick={() =>
              start.mutate(note, {
                onSuccess: (result) => {
                  onStarted?.(result);
                  close(false);
                },
              })
            }
          >
            {start.isPending && <Loader2 className="size-4 animate-spin" />}
            Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
