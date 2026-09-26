import type { PillTone } from "@/components/status-pill";

export type PoStatus = "Draft" | "Sent" | "PartiallyReceived" | "Received" | "Cancelled";

export interface PoLine {
  sku: string;
  orderedQuantity: number;
  receivedQuantity: number;
}

export interface PurchaseOrder {
  id: string;
  supplierName: string;
  status: PoStatus;
  lines: PoLine[];
  openedAt: string;
  closedAt: string | null;
}

export const MAX_LINE_QUANTITY = 99_999;

export const PO_STATUS: Record<PoStatus, { label: string; tone: PillTone; hint: string }> = {
  Draft: { label: "Draft", tone: "neutral", hint: "Not sent to the supplier yet. Nothing has been ordered." },
  Sent: { label: "Sent", tone: "info", hint: "Sent to the supplier. Waiting for the first delivery." },
  PartiallyReceived: { label: "Partially received", tone: "warning", hint: "Some of the order has arrived. More is still expected." },
  Received: { label: "Received", tone: "success", hint: "Everything ordered has arrived." },
  Cancelled: { label: "Cancelled", tone: "danger", hint: "This order was cancelled. Stock already received stays on hand." },
};

// The three actions and the states they're allowed from. These mirror the saga's own guards
// (Send: Draft only; Receive: Sent or PartiallyReceived; Cancel: anything not yet closed), so the
// UI never offers a button the backend would refuse.
export const canSend = (status: PoStatus) => status === "Draft";
export const canReceive = (status: PoStatus) => status === "Sent" || status === "PartiallyReceived";
export const canCancel = (status: PoStatus) => status !== "Received" && status !== "Cancelled";

export function totals(order: PurchaseOrder) {
  const ordered = order.lines.reduce((sum, l) => sum + l.orderedQuantity, 0);
  const received = order.lines.reduce((sum, l) => sum + l.receivedQuantity, 0);
  // Remaining counts per line, so an over-shipped line can't hide a shortfall on another.
  const remaining = order.lines.reduce((sum, l) => sum + Math.max(0, l.orderedQuantity - l.receivedQuantity), 0);
  return { ordered, received, remaining };
}

// "PO-1A2B3C4D": the first block of the GUID is short enough to read out over the phone.
export const shortId = (id: string) => `PO-${id.slice(0, 8).toUpperCase()}`;

export const PO_FILTERS = [
  { id: "all", label: "All" },
  { id: "Draft", label: "Draft" },
  { id: "Sent", label: "Sent" },
  { id: "PartiallyReceived", label: "Partially received" },
  { id: "Received", label: "Received" },
  { id: "Cancelled", label: "Cancelled" },
] as const;
export type PoFilter = (typeof PO_FILTERS)[number]["id"];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
