import { redirect } from "next/navigation";
import { SellerShell } from "@/components/shells/seller-shell";
import { getSession } from "@/lib/session";

export default async function SellerLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <SellerShell username={session.username} role={session.role}>
      {children}
    </SellerShell>
  );
}
