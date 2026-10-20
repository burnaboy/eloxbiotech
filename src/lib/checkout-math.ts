/*
 * Order totals, in integer kobo only. Pure functions: no database, easy to test.
 *
 *   subtotal  = Σ unit price × quantity (sale prices already applied)
 *   discount  = from an approved code, split across lines in proportion to their value
 *   shipping  = flat + per-kg, free over the threshold (threshold checked after discount)
 *   VAT       = when enabled: either the VAT inside VAT-inclusive prices, or added on top
 *   total     = subtotal − discount + shipping (+ VAT when added on top)
 *
 * Each line records what the customer paid for it (paidMinor) and its value excluding VAT after discount
 * (netMinor). Partial refunds and commissions are worked out from those two figures.
 */

export interface QuoteLine {
  unitMinor: number;
  quantity: number;
  pv: number;
  weightGrams: number;
  taxable: boolean;
}

export interface DiscountRule {
  type: "PERCENT" | "FIXED";
  /** PERCENT: basis points. FIXED: kobo. */
  value: number;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
}

export interface TaxRule {
  enabled: boolean;
  rateBps: number;
  included: boolean;
  shipping: boolean;
}

export interface ShippingRule {
  flatShippingMinor: number;
  perKgShippingMinor?: number;
  freeShippingOverMinor: number;
}

/** Splits `total` across `weights` in proportion, in whole kobo, with the remainder going to the largest fractions. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  // BigInt keeps total × weight exact even for very large amounts.
  const T = BigInt(total);
  const S = BigInt(sum);
  const parts = weights.map((w, i) => ({ i, q: (T * BigInt(w)) / S, r: (T * BigInt(w)) % S }));
  let left = total - parts.reduce((a, p) => a + Number(p.q), 0);
  const byRemainder = [...parts].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const out = parts.map((p) => Number(p.q));
  for (const p of byRemainder) {
    if (left <= 0) break;
    out[p.i]++;
    left--;
  }
  return out;
}

/** round(n / d) half up, for non-negative integers. */
export function divRound(n: number, d: number) {
  return Math.floor((2 * n + d) / (2 * d));
}

export function discountFor(subtotal: number, rule: DiscountRule | null) {
  if (!rule || subtotal <= 0 || subtotal < rule.minSubtotalMinor) return 0;
  let d = rule.type === "PERCENT" ? Math.floor((subtotal * rule.value) / 10_000) : rule.value;
  if (rule.maxDiscountMinor !== null) d = Math.min(d, rule.maxDiscountMinor);
  return Math.max(0, Math.min(d, subtotal));
}

export function shippingFor(goodsMinor: number, weightGrams: number, shop: ShippingRule) {
  if (goodsMinor <= 0) return 0;
  if (shop.freeShippingOverMinor > 0 && goodsMinor >= shop.freeShippingOverMinor) return 0;
  const kg = Math.ceil(Math.max(0, weightGrams) / 1000);
  return shop.flatShippingMinor + (shop.perKgShippingMinor ?? 0) * kg;
}

function vat(base: number, tax: TaxRule) {
  if (!tax.enabled || base <= 0 || tax.rateBps <= 0) return 0;
  return tax.included ? divRound(base * tax.rateBps, 10_000 + tax.rateBps) : divRound(base * tax.rateBps, 10_000);
}

export function quote(lines: QuoteLine[], discount: DiscountRule | null, shop: ShippingRule, tax: TaxRule) {
  const lineMinor = lines.map((l) => l.unitMinor * l.quantity);
  const subtotalMinor = lineMinor.reduce((a, b) => a + b, 0);
  const discountMinor = discountFor(subtotalMinor, discount);
  const lineDiscount = allocate(discountMinor, lineMinor);
  const afterDiscount = lineMinor.map((m, i) => m - lineDiscount[i]);
  const weight = lines.reduce((s, l) => s + l.weightGrams * l.quantity, 0);
  const shippingMinor = shippingFor(subtotalMinor - discountMinor, weight, shop);

  const lineTax = afterDiscount.map((m, i) => (lines[i].taxable ? vat(m, tax) : 0));
  const shippingTax = tax.shipping ? vat(shippingMinor, tax) : 0;
  const taxMinor = lineTax.reduce((a, b) => a + b, 0) + shippingTax;
  const added = tax.enabled && !tax.included;

  const items = lines.map((l, i) => ({
    lineMinor: lineMinor[i],
    discountMinor: lineDiscount[i],
    taxMinor: lineTax[i],
    netMinor: added ? afterDiscount[i] : afterDiscount[i] - lineTax[i],
    paidMinor: added ? afterDiscount[i] + lineTax[i] : afterDiscount[i],
    pv: l.pv * l.quantity,
  }));
  const shippingPaidMinor = shippingMinor + (added ? shippingTax : 0);
  const totalMinor = items.reduce((s, i) => s + i.paidMinor, 0) + shippingPaidMinor;
  return {
    subtotalMinor, discountMinor, shippingMinor, shippingPaidMinor, taxMinor, taxIncluded: !added,
    taxRateBps: tax.enabled ? tax.rateBps : 0, totalMinor, totalPv: items.reduce((s, i) => s + i.pv, 0), weightGrams: weight, items,
  };
}

/**
 * Amount to refund for `qty` more units of a line: the unit's share of what was paid, with the last
 * unit absorbing any rounding so a fully refunded line returns exactly what was paid.
 */
export function lineRefund(item: { quantity: number; paidMinor: number; netMinor: number; refundedQty: number; refundedMinor: number; refundedNetMinor: number }, qty: number) {
  const after = item.refundedQty + qty;
  if (qty <= 0 || after > item.quantity) throw new Error("Invalid refund quantity");
  const paid = after === item.quantity ? item.paidMinor - item.refundedMinor : Math.floor((item.paidMinor * after) / item.quantity) - item.refundedMinor;
  const net = after === item.quantity ? item.netMinor - item.refundedNetMinor : Math.floor((item.netMinor * after) / item.quantity) - item.refundedNetMinor;
  return { paidMinor: paid, netMinor: net };
}
