import { useFormatter, useTranslations } from "next-intl";

// Dates and relative times follow the UI language, not the browser's locale: they contain words
// ("3 hours ago", month names), so a Greek UI on an English OS would otherwise mix languages.
// Money and plain numbers (format.ts) deliberately still use the browser locale — they're
// digits and separators, not prose.
export function useTimeFormat() {
  const format = useFormatter();
  const t = useTranslations("common");
  return {
    // "3 hours ago" for recent things, where the exact clock time matters less than how fresh it is.
    timeAgo(iso: string, now = Date.now()): string {
      const date = new Date(iso);
      if (Math.abs(now - date.getTime()) < 60_000) return t("justNow");
      return format.relativeTime(date, now);
    },
    formatDateTime: (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }),
    formatTime: (date: Date) => format.dateTime(date, { hour: "2-digit", minute: "2-digit" }),
  };
}
