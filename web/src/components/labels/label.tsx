import { formatMoney } from "@/lib/format";
import { LABEL_HEIGHT_IN, LABEL_WIDTH_IN, type LabelFormat } from "@/lib/label";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarcodeSvg } from "./barcode-svg";
import { QrSvg } from "./qr-svg";

// A physical label at its real size (inches), so what's on screen is what comes out of the
// printer. Always black on white regardless of the app theme — it's paper, not UI.
export function Label({
  item,
  format,
  className,
}: {
  item: Pick<CatalogEntry, "name" | "barcode" | "sku" | "effectivePrice">;
  format: LabelFormat;
  className?: string;
}) {
  const showBarcode = format !== "qr";
  const showQr = format !== "code128";

  return (
    <div
      className={cn("flex flex-col overflow-hidden bg-white p-[0.06in] text-black", className)}
      style={{ width: `${LABEL_WIDTH_IN}in`, height: `${LABEL_HEIGHT_IN}in` }}
    >
      <div className="flex items-baseline justify-between gap-2 text-[7.5pt] leading-tight">
        <span className="truncate font-semibold">{item.name}</span>
        <span className="shrink-0 font-bold tabular-nums">{formatMoney(item.effectivePrice)}</span>
      </div>

      <div className="mt-[0.04in] flex min-h-0 flex-1 items-stretch gap-[0.08in]">
        {showBarcode && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <BarcodeSvg value={item.barcode} className="size-full" />
            </div>
            <div className="text-center font-mono text-[6.5pt] leading-tight">{item.barcode}</div>
          </div>
        )}
        {showQr && (
          <div className="aspect-square h-full shrink-0">
            <QrSvg value={item.barcode} className="size-full" />
          </div>
        )}
      </div>

      {item.sku !== item.barcode && (
        <div className="mt-[0.02in] truncate font-mono text-[5.5pt] leading-tight text-neutral-600">SKU {item.sku}</div>
      )}
    </div>
  );
}
