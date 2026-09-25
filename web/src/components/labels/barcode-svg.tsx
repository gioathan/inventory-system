"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";

// Code128, not EAN/UPC: this system's generated codes are arbitrary 12-digit strings with no
// valid UPC check digit, and Code128 encodes any of them (switching to its compact numeric
// mode automatically). Drawn as SVG so it stays sharp at any print size.
export function BarcodeSvg({ value, className }: { value: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      // margin 0: the label supplies its own quiet zone. jsbarcode also sets fixed pixel
      // width/height attributes; CSS sizing on the element overrides them, and the viewBox
      // it emits keeps the bars in proportion.
      JsBarcode(ref.current, value, { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 60 });
    } catch {
      // A value Code128 can't encode leaves the SVG empty rather than throwing during render.
    }
  }, [value]);

  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} preserveAspectRatio="none" className={className} />;
}
