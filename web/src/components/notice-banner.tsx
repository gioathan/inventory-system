import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { Notice } from "@/hooks/use-item-lookup";
import { cn } from "@/lib/utils";

// Errors are announced assertively (role=alert), successes politely (role=status), so a screen
// reader hears a failed sale immediately but a confirmation doesn't talk over what's happening.
export function NoticeBanner({ notice }: { notice: Notice }) {
  const isError = notice.kind === "error";
  const Icon = isError ? TriangleAlert : CheckCircle2;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm",
        isError ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      {notice.text}
    </div>
  );
}
