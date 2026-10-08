"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Paste rows straight out of a spreadsheet, or pick a CSV. An uploaded file is loaded into the
// same text box rather than imported blind, so what's about to be added is always visible first.
export function DeliveryImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns false when the text held no usable rows. */
  onImport: (text: string) => boolean;
}) {
  const t = useTranslations("receive.delivery.import");
  const tc = useTranslations("common");
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function submit() {
    if (onImport(text)) {
      setText("");
      setEmpty(false);
      onOpenChange(false);
    } else {
      setEmpty(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <textarea
          id="delivery-import-text"
          aria-label={t("pasteLabel")}
          aria-invalid={empty}
          aria-describedby={empty ? "delivery-import-msg" : undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setEmpty(false);
          }}
          rows={8}
          autoFocus
          spellCheck={false}
          placeholder={"5201234567890\t24\n5209876543210\t12"}
          className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        {empty && (
          <p id="delivery-import-msg" role="alert" className="text-sm text-destructive">
            {t("empty")}
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="sr-only"
          aria-label={t("upload")}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // so choosing the same file again still fires onChange
            if (!file) return;
            setText(await file.text());
            setEmpty(false);
          }}
        />

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" className="h-10" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            {t("upload")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" className="h-10" onClick={() => onOpenChange(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="button" className="h-10" onClick={submit}>
              {t("add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
