"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import type { Role } from "@/lib/jwt";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("common");
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("toggleTheme")}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

const OTHER_LOCALE: Record<Locale, Locale> = { en: "el", el: "en" };

export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const nextLocale = OTHER_LOCALE[locale];

  function switchLocale() {
    // The layout reads this cookie server-side to pick which messages to load, so a plain
    // client-side state flip wouldn't be enough — router.refresh() re-runs it with the new value.
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <Button variant="ghost" size="icon" aria-label={t("switchLanguage")} onClick={switchLocale}>
      <span className="text-xs font-semibold uppercase">{nextLocale}</span>
    </Button>
  );
}

export function UserMenu({ username, role, compact = false }: { username: string; role: Role; compact?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("common");

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear(); // never leave one user's cached data around for the next sign-in
    router.replace("/login");
  }

  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-medium">{username}</div>
          <div className="text-xs text-muted-foreground">{t(`roles.${role}`)}</div>
        </div>
      )}
      <LanguageToggle />
      <ThemeToggle />
      <Button variant="ghost" size="icon" aria-label={t("signOut")} onClick={signOut}>
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
