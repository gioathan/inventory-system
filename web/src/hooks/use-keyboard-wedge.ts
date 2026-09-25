"use client";

import { useEffect, useRef } from "react";

// A hardware barcode scanner is a keyboard: it "types" the code, then presses Enter. This
// listens for that burst anywhere on the page, so scanning works even when nothing is focused.
//
// It also fixes a real hazard: if focus happens to be on a button (say "Confirm sale") when a
// scan arrives, the trailing Enter would press it. Consuming the Enter here prevents that.
//
// Told apart from a human by speed: scanners emit characters a few ms apart, people don't.
const MAX_GAP_MS = 80;
const MIN_LENGTH = 4;

export function useKeyboardWedge(onScan: (code: string) => void, enabled = true) {
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;

    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Typing in a real field is the person's own input; the visible scan box handles its own Enter.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      const now = performance.now();
      if (now - last > MAX_GAP_MS) buffer = "";
      last = now;

      if (event.key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= MIN_LENGTH) {
          event.preventDefault();
          handler.current(code);
        }
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
