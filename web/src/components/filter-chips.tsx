import { ITEM_FILTERS, type ItemFilter } from "@/lib/item-filters";
import { cn } from "@/lib/utils";

// Horizontally scrollable on phones (edge-to-edge), wrapping on larger screens.
export function FilterChips({
  value,
  onChange,
  counts,
}: {
  value: ItemFilter;
  onChange: (filter: ItemFilter) => void;
  counts: Record<ItemFilter, number>;
}) {
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      aria-label="Filter"
    >
      {ITEM_FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={value === f.id}
          onClick={() => onChange(f.id)}
          className={cn(
            "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
            value === f.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label}
          <span className="tabular-nums opacity-80">{counts[f.id]}</span>
        </button>
      ))}
    </div>
  );
}
