"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AuditEntry, StaffUser, StockAlert } from "@/lib/types";

// Everything here is admin-only in the backend; only call these from admin screens.
export function useStaff() {
  return useQuery({ queryKey: ["staff"], queryFn: () => apiFetch<StaffUser[]>("staff", "staff") });
}

export function useAuditLog() {
  return useQuery({ queryKey: ["audit-log"], queryFn: () => apiFetch<AuditEntry[]>("staff", "audit-log") });
}

// Served by the Notification service, which keeps the most recent 100 alerts.
export function useAlerts() {
  return useQuery({ queryKey: ["alerts"], queryFn: () => apiFetch<StockAlert[]>("notification", "alerts") });
}
