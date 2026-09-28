"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { gql } from "@/lib/graphql";
import type { CurrentSessionSales, RestockSession, SessionReportLine } from "@/lib/types";

// Readable by sellers too: the Receive screen shows which session their receives land in.
export function useCurrentSession() {
  return useQuery({
    queryKey: ["restock-sessions", "current"],
    queryFn: async () => (await apiFetch<{ session: RestockSession | null }>("gateway", "restock-sessions/current")).session,
  });
}

// Units sold/received per item in the open session, keyed by SKU. Counts only, so sellers can
// use it (Stock, Scan). Empty map when no session is open.
export function useCurrentSessionSales() {
  return useQuery({
    queryKey: ["restock-sessions", "current", "sales"],
    queryFn: async () => {
      const data = await apiFetch<CurrentSessionSales>("gateway", "restock-sessions/current/sales");
      return { session: data.session, bySku: new Map(data.lines.map((l) => [l.sku, l])) };
    },
  });
}

// The current session's full report (with revenue) keyed by SKU, for admin screens.
export function useCurrentSessionReport() {
  const current = useCurrentSession();
  const report = useSessionReport(current.data?.id ?? null);
  return {
    session: current.data ?? null,
    isPending: current.isPending || (!!current.data && report.isPending),
    error: current.error ?? report.error,
    bySku: new Map((report.data ?? []).map((l) => [l.sku, l])),
  };
}

// Everything below is admin-only in the backend.
export function useRestockSessions() {
  return useQuery({
    queryKey: ["restock-sessions", "list"],
    queryFn: () => apiFetch<RestockSession[]>("gateway", "restock-sessions"),
  });
}

const REPORT_QUERY = /* GraphQL */ `
  query SessionReport($sessionId: UUID!) {
    sessionReport(sessionId: $sessionId) {
      sku
      name
      categoryId
      restocked
      sold
      netDelta
      openingQuantity
      closingQuantity
      revenue
      revenueEstimated
    }
  }
`;

const reportQuery = (sessionId: string | null) => ({
  queryKey: ["restock-sessions", "report", sessionId],
  queryFn: async () => (await gql<{ sessionReport: SessionReportLine[] }>(REPORT_QUERY, { sessionId })).sessionReport,
  enabled: sessionId !== null,
});

export function useSessionReport(sessionId: string | null) {
  return useQuery(reportQuery(sessionId));
}

// Several reports at once (Insights over the last N sessions). Same cache entries as
// useSessionReport, so switching between tabs doesn't refetch.
export function useSessionReports(sessionIds: string[]) {
  return useQueries({ queries: sessionIds.map((id) => reportQuery(id)) });
}

export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) =>
      apiFetch<{ opened: RestockSession; closed: RestockSession | null }>("gateway", "restock-sessions", {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || null }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["restock-sessions"] }),
  });
}

export function useCloseSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<RestockSession>("gateway", `restock-sessions/${id}/close`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["restock-sessions"] }),
  });
}
