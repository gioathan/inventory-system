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
