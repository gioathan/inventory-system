import QRCode from "qrcode";

// Built from the QR library's module matrix as a single <path>, rather than injecting its SVG
// string as HTML — nothing here ever goes through dangerouslySetInnerHTML.
export function QrSvg({ value, className }: { value: string; className?: string }) {
  const { size, path } = (() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    let d = "";
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  })();

  // A 4-module white border all round is the QR spec's required quiet zone; without it many
  // scanners refuse to lock on.
  const margin = 4;
  return (
    <svg
      viewBox={`${-margin} ${-margin} ${size + margin * 2} ${size + margin * 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code ${value}`}
      className={className}
    >
      <rect x={-margin} y={-margin} width={size + margin * 2} height={size + margin * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
