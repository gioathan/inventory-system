import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// A native <select>: the best mobile picker there is (the OS's own), fully accessible, and no
// popover logic to maintain. Styled to match Input, with two adjustments the plain Input pattern
// doesn't need:
// - The browser's own arrow is replaced by one that matches the rest of the icon set — left on, a
//   plain <select> renders whatever arrow (or none at all) the OS feels like, which is the one
//   place a bare native control stood out against an otherwise fully styled UI.
// - The box (and, in Chromium/Firefox, the dropdown's option list with it) gets a solid
//   `bg-popover`/`text-popover-foreground` instead of Input's transparent fill: transparent has
//   nothing for the OS-drawn option list to pick up, so it fell back to a plain white list even in
//   dark mode. `color-scheme` (globals.css) covers browsers that don't extend that styling to the
//   list at all, so the popup still lands on the right side of light/dark rather than defaulting
//   to light.
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "h-11 w-full appearance-none rounded-lg border border-input bg-popover px-3 pr-9 text-sm text-popover-foreground outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive",
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
