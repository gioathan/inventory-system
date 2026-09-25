"use client";

import {
  createColumnHelper,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Loader2, Percent, Plus, Printer, Search, Tag, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/checkbox";
import { FilterChips } from "@/components/filter-chips";
import { ItemImage } from "@/components/item-image";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useCategories, useItems } from "@/hooks/use-items";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toCsv, downloadCsv } from "@/lib/csv";
import { formatMoney, formatPercent } from "@/lib/format";
import { ITEM_FILTERS, matchesSearch, type ItemFilter } from "@/lib/item-filters";
import { stockLevel } from "@/lib/stock";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DiscountDialog } from "./discount-dialog";
import { ItemPanel } from "./item-panel";

const PAGE_SIZE = 25;
const columnHelper = createColumnHelper<CatalogEntry>();

function StockPill({ item }: { item: CatalogEntry }) {
  const level = stockLevel(item.quantityOnHand);
  if (level === "out") return <StatusPill tone="danger">{item.quantityOnHand === null ? "Not stocked" : "Out"}</StatusPill>;
  if (level === "low") return <StatusPill tone="warning">Low · {item.quantityOnHand}</StatusPill>;
  return <StatusPill tone="success">{item.quantityOnHand}</StatusPill>;
}

function PriceCell({ item }: { item: CatalogEntry }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="font-medium tabular-nums">{formatMoney(item.effectivePrice)}</span>
      {item.discountPercentage !== null && (
        <span className="flex items-center gap-1 text-[0.7rem] tabular-nums text-warning">
          <Tag className="size-3" />
          {formatPercent(item.discountPercentage)} off
        </span>
      )}
    </div>
  );
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") return <ArrowUp className="size-3.5" />;
  if (direction === "desc") return <ArrowDown className="size-3.5" />;
  return <ArrowUpDown className="size-3.5 opacity-40" />;
}

export function CatalogView() {
  // TanStack Table returns functions the React Compiler can't memoize safely (documented
  // incompatibility), so this component opts out of automatic memoization rather than risk stale UI.
  "use no memo";

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const items = useItems();
  const categories = useCategories();
  const isWide = useMediaQuery("(min-width: 1024px)");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [discountOpen, setDiscountOpen] = useState(false);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );
  // The open item lives in the URL (?sku=), so a panel is linkable and survives a refresh, and
  // Back/Forward behave.
  const openSku = params.get("sku");
  const openEntry = openSku ? all.find((i) => i.sku === openSku) : undefined;
  const nameOf = (item: CatalogEntry) => (item.categoryId ? (categoryName.get(item.categoryId) ?? "") : "");

  const counts = useMemo(
    () => Object.fromEntries(ITEM_FILTERS.map((f) => [f.id, all.filter(f.matches).length])) as Record<ItemFilter, number>,
    [all],
  );

  const rows = useMemo(() => {
    const active = ITEM_FILTERS.find((f) => f.id === filter)!;
    return all.filter(active.matches).filter((item) => matchesSearch(item, search, [nameOf(item)]));
    // nameOf reads categoryName, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter, search, categoryName]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      }),
      // Image, name and SKU share one cell: a wide table with a docked detail panel beside it has
      // no room for a column each, and this is the layout people expect from an item list.
      columnHelper.accessor("name", {
        id: "name",
        header: "Item",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ItemImage src={row.original.imageUrl} alt="" className="size-10 rounded-lg" />
            <div className="min-w-0">
              <button type="button" onClick={() => openItem(row.original.sku)} className="block max-w-56 truncate text-left font-medium hover:underline">
                {row.original.name}
              </button>
              <div className="truncate font-mono text-xs text-muted-foreground">{row.original.sku}</div>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor((item) => nameOf(item), {
        id: "category",
        header: "Category",
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() || "—"}</span>,
      }),
      columnHelper.accessor("effectivePrice", {
        id: "price",
        header: "Price",
        meta: { align: "right" },
        cell: ({ row }) => <PriceCell item={row.original} />,
      }),
      columnHelper.accessor((item) => item.quantityOnHand ?? -1, {
        id: "stock",
        header: "Stock",
        meta: { align: "right" },
        cell: ({ row }) => <StockPill item={row.original} />,
      }),
    ],
    // openItem/nameOf are recreated each render but only read current state via closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryName],
  );

  // Known, documented incompatibility (see the "use no memo" note above); this component is opted out.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (item) => item.sku,
    // TanStack sorts numeric columns descending on the first click; people expect low-to-high first.
    sortDescFirst: false,
    // The panel takes a third of the width, so the least essential column steps aside while it is open.
    state: { sorting, rowSelection, columnVisibility: { category: !(isWide && openEntry) } },
    initialState: { pagination: { pageSize: PAGE_SIZE } },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedSkus = Object.keys(rowSelection).filter((sku) => rowSelection[sku] && all.some((i) => i.sku === sku));
  const pageRows = table.getRowModel().rows;
  const { pageIndex } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;

  function openItem(sku: string) {
    router.replace(`${pathname}?sku=${encodeURIComponent(sku)}`, { scroll: false });
  }
  function closeItem() {
    router.replace(pathname, { scroll: false });
  }

  function exportCsv() {
    const sorted = table.getSortedRowModel().rows.map((r) => r.original);
    downloadCsv(
      "catalog.csv",
      toCsv(
        ["SKU", "Name", "Barcode", "Category", "List price", "Discount %", "Price", "Stock"],
        sorted.map((i) => [
          i.sku, i.name, i.barcode, nameOf(i), i.price,
          i.discountPercentage === null ? null : Math.round(i.discountPercentage * 100),
          i.effectivePrice, i.quantityOnHand,
        ]),
      ),
    );
  }

  const panel = openEntry && (
    <ItemPanel item={openEntry} categoryName={nameOf(openEntry) || null} onClose={isWide ? closeItem : undefined} />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Items &amp; SKUs</h1>
          <p className="text-sm text-muted-foreground">
            {items.isSuccess ? `${all.length} items in the catalog` : "Everything you sell, with live stock."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-10 gap-2" onClick={exportCsv} disabled={!rows.length}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <Link href="/catalog/new" className={cn(buttonVariants(), "h-10 gap-2")}>
            <Plus className="size-4" />
            New SKU
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search items"
            placeholder="Search by name, SKU, barcode or category"
            autoComplete="off"
            spellCheck={false}
            className="h-11 pl-9 pr-10"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <FilterChips value={filter} onChange={setFilter} counts={counts} />
      </div>

      {selectedSkus.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="mr-auto text-sm font-medium">{selectedSkus.length} selected</span>
          <Button type="button" variant="outline" className="h-9 gap-2" onClick={() => setDiscountOpen(true)}>
            <Percent className="size-4" />
            Batch discount
          </Button>
          <Link
            href={`/labels/print?${selectedSkus.map((s) => `sku=${encodeURIComponent(s)}`).join("&")}`}
            className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2")}
          >
            <Printer className="size-4" />
            Print labels
          </Link>
          <Button type="button" variant="ghost" className="h-9" onClick={() => setRowSelection({})}>
            Clear
          </Button>
        </div>
      )}

      <div className={cn("grid gap-6", isWide && openEntry && "lg:grid-cols-[minmax(0,1fr)_23rem]")}>
        <div className="min-w-0">
          {items.isPending ? (
            <div className="flex flex-col gap-2" aria-label="Loading catalog">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
              ))}
            </div>
          ) : items.isError ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
              <p className="text-destructive">Couldn&apos;t load the catalog: {items.error.message}</p>
              <Button type="button" variant="outline" onClick={() => items.refetch()}>
                {items.isFetching && <Loader2 className="size-4 animate-spin" />}
                Try again
              </Button>
            </div>
          ) : total === 0 ? (
            <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {all.length === 0 ? "No items yet. Add your first SKU to get started." : "No items match. Try a different search or filter."}
            </div>
          ) : (
            <>
              {/* Table from md up; the same rows as cards on phones, where a wide table would scroll sideways. */}
              <div className="hidden overflow-x-auto rounded-2xl border md:block">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    {table.getHeaderGroups().map((group) => (
                      <tr key={group.id}>
                        {group.headers.map((header) => {
                          const right = (header.column.columnDef.meta as { align?: string } | undefined)?.align === "right";
                          const sortable = header.column.getCanSort() && header.column.id !== "select";
                          return (
                            <th
                              key={header.id}
                              scope="col"
                              aria-sort={
                                header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"
                              }
                              className={cn("px-3 py-3 font-medium", right ? "text-right" : "text-left")}
                            >
                              {header.isPlaceholder ? null : sortable ? (
                                <button
                                  type="button"
                                  onClick={header.column.getToggleSortingHandler()}
                                  className={cn("inline-flex items-center gap-1.5 uppercase tracking-wider hover:text-foreground", right && "flex-row-reverse")}
                                >
                                  {String(header.column.columnDef.header)}
                                  <SortIcon direction={header.column.getIsSorted()} />
                                </button>
                              ) : typeof header.column.columnDef.header === "function" ? (
                                header.column.columnDef.header(header.getContext())
                              ) : (
                                header.column.columnDef.header
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="divide-y">
                    {pageRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => openItem(row.original.sku)}
                        className={cn("cursor-pointer transition-colors hover:bg-muted/40", openSku === row.original.sku && "bg-primary/5")}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const right = (cell.column.columnDef.meta as { align?: string } | undefined)?.align === "right";
                          return (
                            <td key={cell.id} className={cn("px-3 py-2.5 align-middle", right && "text-right")}>
                              <div className={cn(right && "flex justify-end")}>
                                {cell.column.columnDef.cell && typeof cell.column.columnDef.cell === "function"
                                  ? cell.column.columnDef.cell(cell.getContext())
                                  : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="flex flex-col gap-2 md:hidden">
                {pageRows.map((row) => {
                  const item = row.original;
                  return (
                    <li key={row.id} className={cn("flex items-center gap-3 rounded-xl border bg-card p-3", openSku === item.sku && "border-primary")}>
                      <Checkbox aria-label={`Select ${item.name}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
                      <button type="button" onClick={() => openItem(item.sku)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <ItemImage src={item.imageUrl} alt="" className="size-12 rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.name}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">{item.sku}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <PriceCell item={item} />
                          <StockPill item={item} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span aria-live="polite">
                  {pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" aria-label="Previous page" className="size-10" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" aria-label="Next page" className="size-10" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {isWide && openEntry && <aside className="sticky top-20 self-start rounded-2xl border bg-card p-5">{panel}</aside>}
      </div>

      {/* Below lg there's no room for a docked column, so the same panel opens as a sheet. */}
      {!isWide && (
        <Sheet open={Boolean(openEntry)} onOpenChange={(open) => !open && closeItem()}>
          <SheetContent side="right" className="overflow-y-auto p-5 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
            <SheetTitle className="sr-only">Item details</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      )}

      <DiscountDialog
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        items={all.filter((i) => selectedSkus.includes(i.sku))}
        onDone={() => setRowSelection({})}
      />
    </div>
  );
}
