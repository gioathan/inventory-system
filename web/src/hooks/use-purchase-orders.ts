"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PurchaseOrder } from "@/lib/po";

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiFetch<PurchaseOrder[]>("gateway", "purchase-orders"),
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ["purchase-orders", id],
    queryFn: () => apiFetch<PurchaseOrder>("gateway", `purchase-orders/${id}`),
  });
}
