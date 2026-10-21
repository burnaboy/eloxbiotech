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

function luminance([r, g, b]: number[]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: number[], b: number[]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A version of a brand colour that reads on the dark background: the colour is mixed with white
 * in small steps until text in it reaches the 4.5:1 contrast that WCAG asks for. Returns an "r g b" triplet.
 */
export function darkModeVariant(hex: string, background = [14, 17, 16], minRatio = 4.5) {
  const n = parseInt(hex.replace("#", ""), 16);
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let rgb = base;
  for (let t = 0; t <= 1.0001 && contrastRatio(rgb, background) < minRatio; t += 0.05) {
    rgb = base.map((v) => Math.round(v + (255 - v) * t));
  }
  return rgb.join(" ");
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
