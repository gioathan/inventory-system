import type { Metadata } from "next";
import { ReceiveStock } from "@/components/receive/receive-stock";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Receive stock" };

export default async function ReceivePage({ searchParams }: PageProps<"/receive">) {
  const { barcode } = await searchParams;
  // The layout has already redirected signed-out users; role only decides whether the
  // session banner offers "Start session" (the backend enforces admin-only regardless).
  const session = await getSession();
  return <ReceiveStock initialCode={typeof barcode === "string" ? barcode : undefined} isAdmin={session?.role === "Admin"} />;
}
