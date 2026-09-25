import type { Metadata } from "next";
import { NewItemForm } from "@/components/catalog/new-item-form";

export const metadata: Metadata = { title: "New SKU" };

export default function NewItemPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New SKU</h1>
        <p className="text-sm text-muted-foreground">Add an item to the catalog and put its first stock on the shelf.</p>
      </div>
      <NewItemForm />
    </div>
  );
}
