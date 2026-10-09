import { ClipboardList, LayoutDashboard, PackagePlus, PackageSearch, Percent, ScanBarcode, ScrollText, Shapes, Tags, Users, type LucideIcon } from "lucide-react";
import type navMessages from "@/messages/en/nav.json";

// labelKey/groupLabelKey index into the "nav" message namespace (src/messages/<locale>/nav.json)
// — the shells that render these resolve the actual text via useTranslations("nav"), since a
// plain data module like this one can't call hooks itself.
export interface NavItem {
  href: string;
  labelKey: `items.${keyof typeof navMessages.items}`;
  icon: LucideIcon;
}

export interface NavGroup {
  groupLabelKey: `groups.${keyof typeof navMessages.groups}`;
  items: NavItem[];
}

// Only routes that exist are listed; each phase adds its own entries here, so the nav never
// links to a page that 404s.
export const ADMIN_NAV: NavGroup[] = [
  {
    groupLabelKey: "groups.operations",
    items: [
      { href: "/dashboard", labelKey: "items.dashboard", icon: LayoutDashboard },
      { href: "/scan", labelKey: "items.scanTerminal", icon: ScanBarcode },
      { href: "/receive", labelKey: "items.receiveStock", icon: PackagePlus },
      { href: "/stock", labelKey: "items.stockLookup", icon: PackageSearch },
    ],
  },
  {
    groupLabelKey: "groups.catalog",
    items: [
      { href: "/catalog", labelKey: "items.itemsAndSkus", icon: Tags },
      { href: "/categories", labelKey: "items.categories", icon: Shapes },
      { href: "/discounts", labelKey: "items.discountsAndPromos", icon: Percent },
    ],
  },
  {
    groupLabelKey: "groups.supplyChain",
    items: [{ href: "/restock-sessions", labelKey: "items.restockSessions", icon: ClipboardList }],
  },
  {
    groupLabelKey: "groups.teamAndControl",
    items: [
      { href: "/staff", labelKey: "items.staffAccounts", icon: Users },
      { href: "/audit-log", labelKey: "items.auditLog", icon: ScrollText },
    ],
  },
];

export const SELLER_NAV: NavItem[] = [
  { href: "/scan", labelKey: "items.scan", icon: ScanBarcode },
  { href: "/stock", labelKey: "items.stock", icon: PackageSearch },
];

// What an admin sees in the same shell: the seller screens plus Receive, which is admin-only.
export const SELLER_SHELL_ADMIN_NAV: NavItem[] = [
  SELLER_NAV[0],
  { href: "/receive", labelKey: "items.receive", icon: PackagePlus },
  SELLER_NAV[1],
];
