import type { Product, ProductVariant } from "@prisma/client";
import type { Tx } from "./db";

/*
 * Pricing rules. All amounts are integers in kobo; no floating point touches money.
 * - A variant's own price, sale price and PV override the product's when set.
 * - A sale price applies only inside its optional start/end window and only when it is below the regular price.
 * - The browser never sends prices: cart totals and orders are always computed here from database records.
 */

type PriceFields = Pick<Product, "priceMinor" | "salePriceMinor" | "saleStartsAt" | "saleEndsAt" | "pv">;
type VariantPriceFields = Pick<ProductVariant, "priceMinor" | "salePriceMinor" | "pv">;

export interface UnitPrice {
  /** What the customer pays per unit. */
  unitMinor: number;
  /** The regular price, when unitMinor is a sale price. */
  compareAtMinor: number | null;
  pv: number;
}

export function saleActive(p: Pick<Product, "saleStartsAt" | "saleEndsAt">, now = new Date()) {
  return (!p.saleStartsAt || p.saleStartsAt <= now) && (!p.saleEndsAt || p.saleEndsAt > now);
}

export function unitPrice(p: PriceFields, v?: VariantPriceFields | null, now = new Date()): UnitPrice {
  const regular = v?.priceMinor ?? p.priceMinor;
  const sale = v ? (v.salePriceMinor ?? (v.priceMinor === null ? p.salePriceMinor : null)) : p.salePriceMinor;
  const pv = v?.pv ?? p.pv;
  if (sale !== null && sale !== undefined && sale < regular && saleActive(p, now)) {
    return { unitMinor: sale, compareAtMinor: regular, pv };
  }
  return { unitMinor: regular, compareAtMinor: null, pv };
}

/** Lowest price a shopper can currently pay for this product, used for sorting and "from" prices. */
export function lowestPrice(p: PriceFields, variants: (VariantPriceFields & { active: boolean })[], now = new Date()) {
  const live = variants.filter((v) => v.active);
  if (!live.length) return unitPrice(p, null, now);
  return live.map((v) => unitPrice(p, v, now)).reduce((a, b) => (b.unitMinor < a.unitMinor ? b : a));
}

/** Recomputes the stored sort/filter price for one product. Call after any price or variant change. */
export async function refreshListPrice(tx: Tx, productId: string, now = new Date()) {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: true } });
  const lp = lowestPrice(p, p.variants, now).unitMinor;
  if (lp !== p.listPriceMinor) await tx.product.update({ where: { id: productId }, data: { listPriceMinor: lp } });
  return lp;
}

/** Sale windows open and close on their own; a scheduled job refreshes list prices for products with a sale. */
export async function refreshSalePrices(tx: Tx, now = new Date()) {
  const rows = await tx.product.findMany({
    where: { OR: [{ salePriceMinor: { not: null } }, { variants: { some: { salePriceMinor: { not: null } } } }] },
    select: { id: true },
  });
  let changed = 0;
  for (const r of rows) {
    const before = await tx.product.findUniqueOrThrow({ where: { id: r.id }, select: { listPriceMinor: true } });
    if ((await refreshListPrice(tx, r.id, now)) !== before.listPriceMinor) changed++;
  }
  return changed;
}

export function hasVariants(p: { variants?: { active: boolean }[] }) {
  return !!p.variants?.some((v) => v.active);
}

/** Units a shopper can buy right now. */
export function availableStock(p: Pick<Product, "stock">, v?: Pick<ProductVariant, "stock"> | null) {
  return v ? v.stock : p.stock;
}

export const ATTRIBUTE_LIMIT = 20;

/** Parses "Key: value" lines into a small, safe attribute map. */
export function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().slice(0, 40);
    const v = line.slice(i + 1).trim().slice(0, 200);
    if (k && v && Object.keys(out).length < ATTRIBUTE_LIMIT) out[k] = v;
  }
  return out;
}

export function attributesToText(a: unknown) {
  if (!a || typeof a !== "object") return "";
  return Object.entries(a as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join("\n");
}
