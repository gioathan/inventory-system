import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

// Server-only, called once per request from request.ts. Cookie wins (an explicit choice the
// person already made); otherwise fall back to the browser's own Accept-Language, so a Greek
// browser gets Greek on its very first visit without anyone having to flip the toggle.
export async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = (await headers()).get("accept-language");
  const preferred = acceptLanguage
    ?.split(",")
    .map((tag) => tag.split(";")[0].trim().split("-")[0].toLowerCase())
    .find(isLocale);

  return preferred ?? defaultLocale;
}
