import type { Locale } from "./config";
import type enAudit from "@/messages/en/audit.json";
import type enAuth from "@/messages/en/auth.json";
import type enCatalog from "@/messages/en/catalog.json";
import type enCategories from "@/messages/en/categories.json";
import type enCommon from "@/messages/en/common.json";
import type enDashboard from "@/messages/en/dashboard.json";
import type enDiscounts from "@/messages/en/discounts.json";
import type enLabels from "@/messages/en/labels.json";
import type enNav from "@/messages/en/nav.json";
import type enReceive from "@/messages/en/receive.json";
import type enRestock from "@/messages/en/restock.json";
import type enScan from "@/messages/en/scan.json";
import type enStaff from "@/messages/en/staff.json";
import type enStock from "@/messages/en/stock.json";
import type elAudit from "@/messages/el/audit.json";
import type elAuth from "@/messages/el/auth.json";
import type elCatalog from "@/messages/el/catalog.json";
import type elCategories from "@/messages/el/categories.json";
import type elCommon from "@/messages/el/common.json";
import type elDashboard from "@/messages/el/dashboard.json";
import type elDiscounts from "@/messages/el/discounts.json";
import type elLabels from "@/messages/el/labels.json";
import type elNav from "@/messages/el/nav.json";
import type elReceive from "@/messages/el/receive.json";
import type elRestock from "@/messages/el/restock.json";
import type elScan from "@/messages/el/scan.json";
import type elStaff from "@/messages/el/staff.json";
import type elStock from "@/messages/el/stock.json";

// English is the source of truth for the message shape.
type Messages = {
  audit: typeof enAudit;
  auth: typeof enAuth;
  catalog: typeof enCatalog;
  categories: typeof enCategories;
  common: typeof enCommon;
  dashboard: typeof enDashboard;
  discounts: typeof enDiscounts;
  labels: typeof enLabels;
  nav: typeof enNav;
  receive: typeof enReceive;
  restock: typeof enRestock;
  scan: typeof enScan;
  staff: typeof enStaff;
  stock: typeof enStock;
};

// Registering the shape makes every t("some.key") call type-checked: a typo'd or deleted key is
// a tsc error, not a raw key string showing up on screen.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}

// Fails to compile if any key present in English is missing from Greek. (Extra Greek-only keys
// aren't caught, but those are harmless — nothing reads them.)
type AssertGreekComplete<T extends Messages> = T;
export type GreekIsComplete = AssertGreekComplete<{
  audit: typeof elAudit;
  auth: typeof elAuth;
  catalog: typeof elCatalog;
  categories: typeof elCategories;
  common: typeof elCommon;
  dashboard: typeof elDashboard;
  discounts: typeof elDiscounts;
  labels: typeof elLabels;
  nav: typeof elNav;
  receive: typeof elReceive;
  restock: typeof elRestock;
  scan: typeof elScan;
  staff: typeof elStaff;
  stock: typeof elStock;
}>;
