"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/jwt";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

export function UserMenu({ username, role, compact = false }: { username: string; role: Role; compact?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();

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
          <div className="text-xs text-muted-foreground">{role}</div>
        </div>
      )}
      <ThemeToggle />
      <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
