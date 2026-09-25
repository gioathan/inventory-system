"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import type { ScanItem } from "@/lib/types";

export type Notice = { kind: "success" | "error"; text: string };

export const scanPath = (barcode: string) => `scan/${encodeURIComponent(barcode)}`;

function lookupMessage(error: unknown, barcode: string): string {
  if (error instanceof ApiError && error.status === 404) {
    return `No item found for barcode ${barcode}. It needs to be added to the catalog first.`;
  }
  return error instanceof Error ? error.message : "Couldn't look that up. Try again.";
}

// The scan -> look up -> show-the-item step shared by Scan & Sell and Receiving. GET
// /scan/{barcode} is a pure lookup that never changes stock, so it's safe to run on every scan;
// what happens *next* (sell, receive) is each screen's own explicit action.
export function useItemLookup() {
  const [item, setItem] = useState<ScanItem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const lookup = useMutation({
    mutationFn: (barcode: string) => apiFetch<ScanItem>("gateway", scanPath(barcode)),
    onMutate: () => setNotice(null),
    onSuccess: (found) => setItem(found),
    onError: (error, barcode) => {
      setItem(null);
      setNotice({ kind: "error", text: lookupMessage(error, barcode) });
    },
  });

  function clear() {
    setItem(null);
    setNotice(null);
  }

  return { item, setItem, notice, setNotice, lookup, clear };
}
