import { cn } from "@/lib/utils";

// Horizontally scrollable on phones (edge-to-edge), wrapping on larger screens. Generic over the
// filter ids so item filters and purchase-order filters share one implementation.
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (filter: T) => void;
  counts: Record<T, number>;
}) {
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      aria-label="Filter"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
            value === option.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          <span className="tabular-nums opacity-80">{counts[option.id]}</span>
        </button>
      ))}
    </div>
  );
}
