import type { Metadata } from "next";
import { NewPoForm } from "@/components/po/new-po-form";

export const metadata: Metadata = { title: "New purchase order" };

export default function NewPurchaseOrderPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New purchase order</h1>
        <p className="text-sm text-muted-foreground">Choose the supplier and what you&apos;re ordering from them.</p>
      </div>
      <NewPoForm />
    </div>
  );
}
