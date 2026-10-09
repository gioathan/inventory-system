import { formatMoney } from "@/lib/format";
import { DEFAULT_LABEL_SIZE, type LabelFormat, type LabelSize } from "@/lib/label";
import type { CatalogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarcodeSvg } from "./barcode-svg";
import { QrSvg } from "./qr-svg";

// The height the type and spacing below were designed at; a bigger label scales them up in
// proportion rather than leaving small print in a large box.
const BASE_HEIGHT_MM = 25;

// A physical label at its real size (millimetres), so what's on screen is what comes out of the
// printer. Always black on white regardless of the app theme — it's paper, not UI.
export function Label({
  item,
  format,
  size = DEFAULT_LABEL_SIZE,
  className,
  style,
}: {
  item: Pick<CatalogEntry, "name" | "barcode" | "sku" | "effectivePrice">;
  format: LabelFormat;
  size?: LabelSize;
  className?: string;
  style?: React.CSSProperties;
}) {
  const showBarcode = format !== "qr";
  const showQr = format !== "code128";

  const k = size.heightMm / BASE_HEIGHT_MM;
  const mm = (n: number) => `${n * k}mm`;
  const pt = (n: number) => `${n * k}pt`;

  return (
    <div
      className={cn("flex flex-col overflow-hidden bg-white text-black", className)}
      style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm`, padding: mm(1.5), ...style }}
    >
      <div className="flex items-baseline justify-between leading-tight" style={{ fontSize: pt(7.5), gap: mm(2) }}>
        <span className="truncate font-semibold">{item.name}</span>
        <span className="shrink-0 font-bold tabular-nums">{formatMoney(item.effectivePrice)}</span>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch" style={{ marginTop: mm(1), gap: mm(2) }}>
        {showBarcode && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <BarcodeSvg value={item.barcode} className="size-full" />
            </div>
            <div className="text-center font-mono leading-tight" style={{ fontSize: pt(6.5) }}>
              {item.barcode}
            </div>
          </div>
        )}
        {showQr && (
          <div className="aspect-square h-full shrink-0">
            <QrSvg value={item.barcode} className="size-full" />
          </div>
        )}
      </div>

      {item.sku !== item.barcode && (
        <div className="truncate font-mono leading-tight text-neutral-600" style={{ marginTop: mm(0.5), fontSize: pt(5.5) }}>
          SKU {item.sku}
        </div>
      )}
    </div>
  );
}
