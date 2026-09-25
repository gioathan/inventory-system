const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "USD";

// Only called from client components rendering fetched data, never during SSR, so using the
// browser's own locale here can't cause a server/client mismatch.
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY });

export function formatMoney(amount: number): string {
  return money.format(amount);
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
