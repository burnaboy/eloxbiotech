export const CURRENCY = process.env.CURRENCY ?? "USD";

/** All money is stored as integer minor units (cents, kobo). */
export function formatMoney(minor: number, currency = CURRENCY): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export function toMinor(major: string | number): number {
  const n = typeof major === "number" ? major : Number(major);
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}
