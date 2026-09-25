export type LabelFormat = "code128" | "qr" | "both";

// Which symbologies a printed label carries. Deploy-time config (NEXT_PUBLIC_LABEL_FORMAT), not
// a runtime setting: it's a per-business choice made once — e.g. a shop with only laser
// scanners (which can't read QR) sets `code128`. Scanning never depends on it: the scanner
// reads whichever symbology it sees, so mixed labels in circulation are fine.
const configured = process.env.NEXT_PUBLIC_LABEL_FORMAT;
export const LABEL_FORMAT: LabelFormat = configured === "code128" || configured === "qr" ? configured : "both";

// 2in x 1in: the common thermal shelf/product label size.
export const LABEL_WIDTH_IN = 2;
export const LABEL_HEIGHT_IN = 1;
