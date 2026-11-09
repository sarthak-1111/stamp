/** Money is stored as integer cents. PayPal speaks decimal strings ("5.00"). */

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '–';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function valueToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
