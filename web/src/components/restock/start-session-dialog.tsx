"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useStartSession } from "@/hooks/use-restock-sessions";
import { useTimeFormat } from "@/lib/time";
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
  const t = useTranslations("restock");
  const tc = useTranslations("common");
  const { formatDateTime } = useTimeFormat();

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
          <DialogTitle>{t("startDialog.title")}</DialogTitle>
          <DialogDescription>
            {current
              ? t("startDialog.endsCurrent", { time: formatDateTime(current.openedAt) })
              : t("startDialog.noCurrent")}
          </DialogDescription>
        </DialogHeader>

        <FormField id="session-note" label={t("startDialog.note")} hint={t("startDialog.noteHint")} error={tooLong ? t("startDialog.noteTooLong") : undefined}>
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
            {tc("actions.cancel")}
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
            {t("actions.startSession")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
