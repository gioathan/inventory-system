import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand";
import { LanguageToggle } from "@/components/user-menu";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Wordmark className="text-xl" />
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        <LoginForm next={typeof next === "string" ? next : undefined} />
        <p className="mt-6 text-center text-xs text-muted-foreground">{t("noSignup")}</p>
      </div>
    </main>
  );
}
