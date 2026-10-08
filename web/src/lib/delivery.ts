import { parseCsv } from "./csv";

export interface ImportedRow {
  /** A barcode or a SKU, exactly as it appeared in the list. */
  code: string;
  /** NaN when the list had something in the quantity cell that isn't a positive whole number. */
  quantity: number;
}

const CODE_HEADERS = ["barcode", "sku", "code", "ean", "upc"];
const QUANTITY_HEADERS = ["quantity", "qty", "units", "pieces", "ποσότητα", "ποσοτητα", "τεμάχια", "τεμαχια"];

// "24", and "24.0"/"24,00" as spreadsheets like to export whole numbers; a blank cell means one.
function parseQuantity(cell: string | undefined): number {
  const text = (cell ?? "").trim();
  if (text === "") return 1;
  const whole = /^(\d+)(?:[.,]0+)?$/.exec(text);
  const n = whole ? Number(whole[1]) : NaN;
  return n > 0 ? n : NaN;
}

function splitRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  // Pasting cells out of Excel/Sheets gives tabs; some European exports use semicolons because
  // the comma is their decimal separator. Only real commas go through the quote-aware CSV parser.
  const delimiter = clean.includes("\t") ? "\t" : (clean.match(/;/g)?.length ?? 0) > (clean.match(/,/g)?.length ?? 0) ? ";" : ",";
  if (delimiter === ",") return parseCsv(clean);
  return clean
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")));
}

// Accepts whatever a supplier's list realistically looks like:
//   - with a header row naming a barcode/sku/code column and (optionally) a quantity column,
//     in any order and with other columns around them;
//   - with no header: first column is the code, second the quantity;
//   - a single column of codes (a scanner dumped to a text file), where a repeated code means
//     one more unit — the caller adds rows for the same item together.
export function parseDeliveryList(text: string): ImportedRow[] {
  const rows = splitRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const codeColumns = header.map((name, index) => (CODE_HEADERS.includes(name) ? index : -1)).filter((index) => index >= 0);
  const hasHeader = codeColumns.length > 0;
  const quantityColumn = hasHeader ? header.findIndex((name) => QUANTITY_HEADERS.includes(name)) : 1;

  return (hasHeader ? rows.slice(1) : rows)
    .map((row) => ({
      // With both a barcode and a SKU column, use whichever this row actually filled in.
      code: (hasHeader ? codeColumns.map((index) => row[index]?.trim()).find(Boolean) : row[0]?.trim()) ?? "",
      quantity: quantityColumn >= 0 ? parseQuantity(row[quantityColumn]) : 1,
    }))
    .filter((row) => row.code !== "");
}
