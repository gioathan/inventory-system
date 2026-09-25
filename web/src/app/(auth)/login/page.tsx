import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Wordmark className="text-xl" />
          <p className="text-sm text-muted-foreground">Inventory &amp; barcode operations</p>
        </div>
        <LoginForm next={typeof next === "string" ? next : undefined} />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accounts are created by an administrator. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
