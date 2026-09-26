import type { Metadata } from "next";
import { StaffView } from "@/components/staff/staff-view";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Staff accounts" };

export default async function StaffPage() {
  // Read on the server so the list can mark "(you)" without shipping the token's claims around.
  const session = await getSession();
  return <StaffView currentUsername={session?.username ?? ""} />;
}
