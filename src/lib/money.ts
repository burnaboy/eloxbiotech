/** All money is stored as integer minor units (kobo for NGN). */
export function formatMoney(minor: number, currency = "NGN"): string {
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", { style: "currency", currency }).format(minor / 100);
}

export function toMinor(major: string | number): number {
  const n = typeof major === "number" ? major : Number(String(major).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

export function fromMinor(minor: number) {
  return (minor / 100).toFixed(2);
}
