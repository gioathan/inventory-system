// Mirrors the backend's low-stock alert threshold (Notification.Api reads LowStock:Threshold,
// default 5). Duplicated here rather than fetched because it's a display hint, not a rule the
// frontend enforces — if the backend value is ever changed this needs to follow.
export const LOW_STOCK_THRESHOLD = 5;

export type StockLevel = "out" | "low" | "ok";

export function stockLevel(quantityOnHand: number | null): StockLevel {
  if (quantityOnHand === null || quantityOnHand <= 0) return "out";
  return quantityOnHand <= LOW_STOCK_THRESHOLD ? "low" : "ok";
}
