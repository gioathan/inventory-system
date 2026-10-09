import { redirect } from "next/navigation";
import { homeFor } from "@/lib/roles";
import { getSession } from "@/lib/session";

// Receiving stock is admin-only. These pages live under the seller shell (same layout, used on
// the shop floor), so the admin check the (admin) layout does has to be repeated here.
export default async function ReceiveLayout({ children }: LayoutProps<"/receive">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect(homeFor(session.role));
  return children;
}
