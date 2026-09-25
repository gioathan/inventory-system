"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
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

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
