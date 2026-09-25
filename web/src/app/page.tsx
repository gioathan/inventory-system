import { redirect } from "next/navigation";
import { homeFor } from "@/lib/roles";
import { getSession } from "@/lib/session";

// proxy.ts normally redirects "/" before this renders; this is the fallback so the route
// still behaves correctly if that matcher ever changes.
export default async function Home() {
  const session = await getSession();
  redirect(session ? homeFor(session.role) : "/login");
}
