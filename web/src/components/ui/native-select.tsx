import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// A native <select>: the best mobile picker there is (the OS's own), fully accessible, and no
// popover logic to maintain. Styled to match Input, with the browser's own arrow replaced by one
// that matches the rest of the icon set — left on, a plain <select> renders whatever arrow (or
// none at all) the OS feels like, which is the one place a bare native control stands out against
// an otherwise fully styled UI.
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "h-11 w-full appearance-none rounded-lg border border-input bg-transparent px-3 pr-9 text-sm outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
