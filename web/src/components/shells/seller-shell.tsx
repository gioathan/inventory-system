"use client";

import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import type { Role } from "@/lib/jwt";
import { SELLER_NAV, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SellerShell({
  username,
  role,
  children,
}: {
  username: string;
  role: Role;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // An admin can use the seller screens too; give them a way back to their console.
  const items: NavItem[] =
    role === "Admin" ? [...SELLER_NAV, { href: "/dashboard", label: "Console", icon: LayoutDashboard }] : SELLER_NAV;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Bottom tab bar on phones (thumb reach), left rail from md up. */}
      <nav
        aria-label="Main"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex border-t bg-card/95 backdrop-blur",
          "pb-[env(safe-area-inset-bottom)]",
          "md:sticky md:inset-auto md:top-0 md:h-dvh md:w-24 md:shrink-0 md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:pb-0 md:pt-3",
        )}
      >
        <div className="hidden justify-center pb-3 md:flex">
          <Wordmark className="[&>span:last-child]:hidden" />
        </div>
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // 56px tall: comfortably above the 44px minimum touch target.
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors md:mx-2 md:flex-none md:rounded-lg",
                active ? "text-primary md:bg-primary/10" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <div className="md:hidden">
            <Wordmark />
          </div>
          <div className="ml-auto">
            <UserMenu username={username} role={role} />
          </div>
        </header>
        {/* Bottom padding clears the fixed tab bar on phones. */}
        <main className="flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-6">{children}</main>
      </div>
    </div>
  );
}
