"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import type { Locale } from "@/i18n/config";

export function Providers({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Record<string, unknown>;
  children: React.ReactNode;
}) {
  // Created in state (not module scope) so each browser session gets its own cache and
  // server renders never share one across requests.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // A 401/403 won't fix itself on retry; everything else gets one more try.
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              return status !== 401 && status !== 403 && status !== 404 && failureCount < 1;
            },
          },
        },
      }),
  );

  // The viewer's own zone, not a fixed one. Every date this app formats is fetched data rendered
  // client-side, so the server computing a different zone during SSR never reaches the DOM.
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
