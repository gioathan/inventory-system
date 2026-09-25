"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// A native checkbox (free keyboard and screen-reader behavior), themed with the accent color.
// `indeterminate` is a DOM property, not an attribute, so it has to be set imperatively.
export function Checkbox({
  indeterminate = false,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return <input ref={ref} type="checkbox" className={cn("size-4 cursor-pointer accent-primary", className)} {...props} />;
}
