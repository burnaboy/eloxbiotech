import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "#0f5132" -> "15 81 50" for use in CSS rgb() with alpha. */
export function hexToRgbTriplet(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(d));
}

/** 1050 basis points -> "10.5%". Integer-only formatting. */
export function formatBps(bps: number) {
  const whole = Math.trunc(bps / 100);
  const frac = Math.abs(bps % 100);
  return `${whole}${frac ? `.${String(frac).padStart(2, "0").replace(/0$/, "")}` : ""}%`;
}
