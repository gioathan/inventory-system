import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewItemForm } from "@/components/catalog/new-item-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("catalog");
  return { title: t("meta.newTitle") };
}

export default async function NewItemPage() {
  const t = await getTranslations("catalog");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("newItem.heading")}</h1>
        <p className="text-sm text-muted-foreground">{t("newItem.description")}</p>
      </div>
      <NewItemForm />
    </div>
  );
}
