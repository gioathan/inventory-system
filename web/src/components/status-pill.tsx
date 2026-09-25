import { cn } from "@/lib/utils";

export type PillTone = "success" | "warning" | "danger" | "neutral";

const TONES: Record<PillTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

// State is always a pill, never bare text — so it reads at a glance and the same colors mean
// the same thing everywhere (stock levels now; PO statuses and discounts in later phases).
export function StatusPill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
