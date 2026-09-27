"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string };

// A searchable dropdown for lists too long to scan by eye (categories, mainly) — NativeSelect
// stays the right choice for short, fixed lists (role, copies, label layout), where the OS's own
// picker is simpler and there's nothing to search for. Built on Base UI's Combobox, which filters
// its `items` by label automatically as you type; styled to match NativeSelect/Input (same box,
// same bg-popover fix for the option list, same focus ring).
export function Combobox({
  id,
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  disabled,
  className,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <ComboboxPrimitive.Root
      items={options}
      value={selected}
      onValueChange={(item) => onValueChange(item?.value ?? "")}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxPrimitive.InputGroup className={cn("relative", className)}>
        <ComboboxPrimitive.Input
          id={id}
          placeholder={placeholder}
          aria-describedby={ariaDescribedby}
          aria-invalid={ariaInvalid}
          className={cn(
            "h-11 w-full rounded-lg border border-input bg-popover px-3 pr-9 text-sm text-popover-foreground outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive",
          )}
        />
        <ComboboxPrimitive.Trigger
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground disabled:pointer-events-none"
          aria-label="Show options"
        >
          <ChevronDown className="size-4" />
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner className="z-50 outline-none" sideOffset={4}>
          <ComboboxPrimitive.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] rounded-lg border bg-popover text-popover-foreground shadow-md transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <ComboboxPrimitive.Empty className="px-3 py-2.5 text-sm text-muted-foreground data-empty:hidden">
              No matches.
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-72 overflow-y-auto overscroll-contain p-1 outline-none">
              {(item: ComboboxOption) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <ComboboxPrimitive.ItemIndicator className="col-start-1">
                    <Check className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                  <span className="col-start-2 truncate">{item.label}</span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
