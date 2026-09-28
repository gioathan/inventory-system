import type { Metadata } from "next";
import { SessionsView } from "@/components/restock/sessions-view";

export const metadata: Metadata = { title: "Restock sessions" };

export default function RestockSessionsPage() {
  return <SessionsView />;
}
