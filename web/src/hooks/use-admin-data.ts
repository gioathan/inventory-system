"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AuditEntry, DatedDiscount, StaffUser, StockAlert } from "@/lib/types";

// Everything here is admin-only in the backend; only call these from admin screens.
export function useStaff() {
  return useQuery({ queryKey: ["staff"], queryFn: () => apiFetch<StaffUser[]>("staff", "staff") });
}

// Discounts that apply by themselves on chosen dates and repeat every year. The schedule fields
// (running today, next occurrence, days until it) are worked out by the server on the shop's own
// calendar day.
export function useDatedDiscounts() {
  return useQuery({ queryKey: ["dated-discounts"], queryFn: () => apiFetch<DatedDiscount[]>("gateway", "dated-discounts") });
}

export function useAuditLog() {
  return useQuery({ queryKey: ["audit-log"], queryFn: () => apiFetch<AuditEntry[]>("staff", "audit-log") });
}

// Served by the Notification service, which keeps the most recent 100 alerts.
export function useAlerts() {
  return useQuery({ queryKey: ["alerts"], queryFn: () => apiFetch<StockAlert[]>("notification", "alerts") });
}
