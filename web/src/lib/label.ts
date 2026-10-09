export type LabelFormat = "code128" | "qr" | "both";

// Which symbologies a printed label carries. Deploy-time config (NEXT_PUBLIC_LABEL_FORMAT), not
// a runtime setting: it's a per-business choice made once — e.g. a shop with only laser
// scanners (which can't read QR) sets `code128`. Scanning never depends on it: the scanner
// reads whichever symbology it sees, so mixed labels in circulation are fine.
const configured = process.env.NEXT_PUBLIC_LABEL_FORMAT;
export const LABEL_FORMAT: LabelFormat = configured === "code128" || configured === "qr" ? configured : "both";

export interface LabelSize {
  id: "small" | "medium" | "large" | "xlarge";
  widthMm: number;
  heightMm: number;
}

// The sizes offered on the print page, smallest first. Chosen to tile an A4 sheet without much
// waste (3 across for the first two, 2 across for the others). The smallest is the size labels
// were originally designed at (2in x 1in, near enough), so nothing prints denser than it did.
export const LABEL_SIZES: readonly LabelSize[] = [
  { id: "small", widthMm: 50, heightMm: 25 },
  { id: "medium", widthMm: 60, heightMm: 30 },
  { id: "large", widthMm: 75, heightMm: 40 },
  { id: "xlarge", widthMm: 90, heightMm: 50 },
];

export const DEFAULT_LABEL_SIZE = LABEL_SIZES[0];

// Labels are printed on normal A4 paper and cut out with scissors: this margin on every edge of
// the sheet, and no gap between labels — neighbours share one dashed cut line of this weight,
// so a single cut separates them.
export const SHEET_MARGIN_MM = 10;
export const CUT_LINE_MM = 0.2;

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

// How many labels of this size fit on one A4 page — an estimate for the summary line; the
// browser does the real pagination.
export function labelsPerSheet(size: LabelSize): number {
  const across = Math.floor((A4_WIDTH_MM - 2 * SHEET_MARGIN_MM) / size.widthMm);
  const down = Math.floor((A4_HEIGHT_MM - 2 * SHEET_MARGIN_MM) / size.heightMm);
  return Math.max(across, 1) * Math.max(down, 1);
}
