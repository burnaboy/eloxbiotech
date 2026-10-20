import { AppError } from "./errors";

/** All money is stored as integer minor units (kobo for NGN). No binary floating point is used for amounts. */
export function formatMoney(minor: number, currency = "NGN"): string {
  // Display only: split into whole and fractional parts with integer maths.
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const fmt = new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", { style: "currency", currency, minimumFractionDigits: 2 });
  const parts = fmt.formatToParts(whole);
  const out = parts.map((p) => (p.type === "fraction" ? String(frac).padStart(2, "0") : p.value)).join("");
  return neg ? `-${out}` : out;
}

const AMOUNT_RE = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/** Parses a typed amount like "12,500" or "12500.5" into kobo using string arithmetic. Throws on anything else. */
export function toMinor(major: string | number): number {
  const s = String(major).trim().replace(/,/g, "").replace(/^₦/, "");
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new Error("Invalid amount");
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Like toMinor, but returns null for an empty field. */
export function optionalMinor(v: string | undefined | null) {
  return v === undefined || v === null || String(v).trim() === "" ? null : toMinor(v);
}

/** kobo -> "12500.50" for form fields. */
export function fromMinor(minor: number) {
  const abs = Math.abs(minor);
  return `${minor < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Percentage of an amount, rounded down to the kobo, using integer maths. `basisPoints` = percent × 100. */
export function percentOf(minor: number, basisPoints: number) {
  return Math.floor((minor * basisPoints) / 10_000);
}

/** Signed amount ("-1500" or "+1500") in kobo. */
export function signedMinor(v: string) {
  const s = String(v).trim();
  if (s.startsWith("-")) return -toMinor(s.slice(1));
  return toMinor(s.replace(/^\+/, ""));
}

/** "10.5" (percent) -> 1050 basis points, without floating point. */
export function percentToBps(input: string) {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ""));
  if (!m) throw new AppError("Enter a percentage like 10 or 7.5 (up to two decimal places).");
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (bps > 10_000) throw new AppError("A percentage can't be more than 100.");
  return bps;
}

/** 1050 -> "10.5" for form fields. */
export function bpsToPercent(bps: number) {
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return `${Math.trunc(bps / 100)}${frac ? `.${frac}` : ""}`;
}
