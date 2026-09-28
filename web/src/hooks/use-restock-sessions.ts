"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { gql } from "@/lib/graphql";
import type { RestockSession, SessionReportLine } from "@/lib/types";

// Readable by sellers too: the Receive screen shows which session their receives land in.
export function useCurrentSession() {
  return useQuery({
    queryKey: ["restock-sessions", "current"],
    queryFn: async () => (await apiFetch<{ session: RestockSession | null }>("gateway", "restock-sessions/current")).session,
  });
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
      restocked
      sold
      netDelta
      revenue
    }
  }
`;

export function useSessionReport(sessionId: string | null) {
  return useQuery({
    queryKey: ["restock-sessions", "report", sessionId],
    queryFn: async () => (await gql<{ sessionReport: SessionReportLine[] }>(REPORT_QUERY, { sessionId })).sessionReport,
    enabled: sessionId !== null,
  });
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
