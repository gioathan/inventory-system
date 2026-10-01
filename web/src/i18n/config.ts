export const locales = ["en", "el"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// Browser-scoped, like the theme choice (next-themes) — no per-account persistence, no
// middleware, no /en or /el URL segments. Read server-side (layout) and client-side (the
// language toggle), so the name has to match in both places.
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

// Every namespace a message file exists for. Each locale must have the same set of files —
// getMessages() below imports all of them for whichever locale it's given.
export const NAMESPACES = [
  "common",
  "nav",
  "auth",
  "dashboard",
  "catalog",
  "receive",
  "scan",
  "stock",
  "discounts",
  "staff",
  "restock",
  "categories",
  "labels",
  "audit",
] as const;
export type Namespace = (typeof NAMESPACES)[number];
