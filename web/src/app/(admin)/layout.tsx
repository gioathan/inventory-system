import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shells/admin-shell";
import { homeFor } from "@/lib/roles";
import { getSession } from "@/lib/session";

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect(homeFor(session.role));
  return (
    <AdminShell username={session.username} role={session.role}>
      {children}
    </AdminShell>
  );
}
