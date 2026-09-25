import { LayoutDashboard, PackagePlus, PackageSearch, Percent, ScanBarcode, Shapes, Tags, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Only routes that exist are listed; each phase adds its own entries here, so the nav never
// links to a page that 404s.
export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/scan", label: "Scan Terminal", icon: ScanBarcode },
      { href: "/receive", label: "Receive Stock", icon: PackagePlus },
      { href: "/stock", label: "Stock Lookup", icon: PackageSearch },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/catalog", label: "Items & SKUs", icon: Tags },
      { href: "/categories", label: "Categories", icon: Shapes },
      { href: "/discounts", label: "Discounts & Promos", icon: Percent },
    ],
  },
];

export const SELLER_NAV: NavItem[] = [
  { href: "/scan", label: "Scan", icon: ScanBarcode },
  { href: "/receive", label: "Receive", icon: PackagePlus },
  { href: "/stock", label: "Stock", icon: PackageSearch },
];
