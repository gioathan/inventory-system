// Response shapes from the Scan Gateway. Hand-written for now; if the surface grows they should
// be generated from the gateway's OpenAPI document instead so they can't drift.

/** Reply from GET /scan/{barcode} and POST /scan/{barcode}/sell. */
export interface ScanItem {
  sku: string;
  name: string;
  barcode: string;
  price: number;
  /** Fraction in (0, 1) taken off `price`, or null when no discount is active. */
  discountPercentage: number | null;
  /** What's actually charged: `price` with any discount applied. */
  effectivePrice: number;
  /** Null when the item has a catalog entry but has never been stocked. */
  quantityOnHand: number | null;
  imageUrl: string | null;
}

/** Reply from POST /scan/{barcode}/receive and POST /items/intake. */
export interface ReceiveResult {
  sku: string;
  name: string;
  barcode: string;
  price: number;
  quantityOnHand: number;
}

/** One row from the Dashboard `items` query: catalog data joined with live stock. */
export interface CatalogEntry {
  sku: string;
  name: string;
  barcode: string;
  price: number;
  discountPercentage: number | null;
  effectivePrice: number;
  imageUrl: string | null;
  categoryId: string | null;
  /** Null when the item exists in the catalog but has never been stocked. */
  quantityOnHand: number | null;
}

export interface Category {
  id: string;
  name: string;
}

export interface StaffUser {
  id: string;
  username: string;
  role: "Admin" | "Seller";
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  username: string;
  action: string;
  timestamp: string;
  details: string | null;
}

/** A low-stock alert raised when a stock movement left an item at or under its threshold. */
export interface StockAlert {
  sku: string;
  quantityOnHand: number;
  threshold: number;
  timestamp: string;
}

/** A restocking period. Starting one closes whichever was open; receives made meanwhile are tagged with it. */
export interface RestockSession {
  id: string;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
}

/** One item's movement during a restock session, from the Dashboard's sessionReport query. */
export interface SessionReportLine {
  sku: string;
  name: string | null;
  /** The item's current category, not the one it had at the time. */
  categoryId: string | null;
  restocked: number;
  sold: number;
  netDelta: number;
  /** Stock when the session's period began, and when it ended (or now, while open). */
  openingQuantity: number;
  closingQuantity: number;
  /** What was paid. Null only if older, unpriced sales exist for an item that no longer has a price. */
  revenue: number | null;
  /** True when some units were sold before prices were recorded and are valued at today's price. */
  revenueEstimated: boolean;
}

/** Counts-only view of the open session, readable by sellers (no revenue). */
export interface CurrentSessionSales {
  session: RestockSession | null;
  lines: { sku: string; sold: number; restocked: number }[];
}
