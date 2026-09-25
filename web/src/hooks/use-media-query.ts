"use client";

import { useSyncExternalStore } from "react";

// useSyncExternalStore rather than state + effect: it subscribes to the browser's own
// match-media changes and never renders a stale value. The server snapshot is `false`, so a
// component that branches on this renders its small-screen variant first, then corrects.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
