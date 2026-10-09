import type { DatedDiscount } from "./types";

/** How far ahead a dated discount starts being flagged for review. */
export const REVIEW_WINDOW_DAYS = 14;

export type DatedDiscountStage = "active" | "soon" | "later";

// Running today, coming up within the review window, or further off. A discount whose coming
// year is skipped is never "soon": its next occurrence is the year after.
export function stageOf(discount: DatedDiscount): DatedDiscountStage {
  if (discount.activeToday) return "active";
  return discount.daysUntilNext !== null && discount.daysUntilNext <= REVIEW_WINDOW_DAYS ? "soon" : "later";
}

// An ISO date (yyyy-MM-dd) as a Date at noon UTC: a calendar day with no time of day, which then
// formats as that same day in any time zone a browser is likely to be in.
export function isoDateToDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}
