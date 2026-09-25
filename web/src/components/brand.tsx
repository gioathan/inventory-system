import { cn } from "@/lib/utils";

// Barcode bars with a scan line through them — the mark from the Apex designs, drawn as a
// component so it inherits theme colors instead of being a fixed-color image.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="Apex" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-[oklch(0.145_0.003_286)]" />
      <g className="fill-white/90">
        <rect x="6.5" y="8" width="2.2" height="16" rx="1.1" />
        <rect x="14.4" y="8" width="3" height="16" rx="1.5" />
        <rect x="24" y="8" width="2" height="16" rx="1" />
      </g>
      <g className="fill-primary">
        <rect x="10.4" y="8.5" width="1.6" height="15" rx="0.8" />
        <rect x="20" y="8" width="2" height="16" rx="1" />
        <rect x="4.5" y="15" width="23" height="2" rx="1" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">Apex</span>
    </span>
  );
}
