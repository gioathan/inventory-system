"use client";

import { PackageX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// A plain <img>, not next/image: image URLs are whatever an admin pasted or uploaded (any
// host), so there's no fixed allowlist to give the optimizer. A broken or missing image falls
// back to a neutral placeholder rather than a broken-image icon.
//
// `zoomable` is opt-in: item cards use it, but table-row thumbnails don't, since clicking a row
// already does something (opens the item) and a nested button would steal that click.
export function ItemImage({
  src,
  alt,
  className,
  zoomable = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  zoomable?: boolean;
}) {
  const t = useTranslations("common");
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const box = cn("size-20 shrink-0 rounded-xl bg-muted", className);

  if (!src || failed) {
    return (
      <div className={cn(box, "flex items-center justify-center text-muted-foreground")}>
        <PackageX className="size-6" />
      </div>
    );
  }

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn(box, "object-cover")}
    />
  );

  if (!zoomable) return img;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt ? t("viewFullImageOf", { name: alt }) : t("viewFullImage")}
        className="shrink-0 cursor-zoom-in rounded-xl transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {img}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[calc(100vw-2rem)] items-center p-3 pt-12 sm:max-w-3xl">
          <DialogTitle className="sr-only">{alt || t("viewFullImage")}</DialogTitle>
          {/* object-contain at its natural size, capped to the viewport: the whole image, never cropped. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            className="max-h-[calc(100dvh-7rem)] w-auto max-w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
