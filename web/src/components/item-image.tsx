"use client";

import { PackageX } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// A plain <img>, not next/image: image URLs are whatever an admin pasted or uploaded (any
// host), so there's no fixed allowlist to give the optimizer. A broken or missing image falls
// back to a neutral placeholder rather than a broken-image icon.
export function ItemImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = cn("size-20 shrink-0 rounded-xl bg-muted", className);

  if (!src || failed) {
    return (
      <div className={cn(box, "flex items-center justify-center text-muted-foreground")}>
        <PackageX className="size-6" />
      </div>
    );
  }
  return (
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
}
