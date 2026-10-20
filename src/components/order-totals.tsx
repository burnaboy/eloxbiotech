import type { Order } from "@prisma/client";
import { formatMoney } from "@/lib/money";

/** Subtotal, discount, delivery, VAT, total and refunds, exactly as stored on the order. */
export function OrderTotals({ order, taxLabel = "VAT" }: { order: Pick<Order, "currency" | "subtotalMinor" | "discountMinor" | "discountCode" | "shippingMinor" | "taxMinor" | "taxIncluded" | "taxRateBps" | "totalMinor" | "refundedMinor">; taxLabel?: string }) {
  const m = (v: number) => formatMoney(v, order.currency);
  const rate = order.taxRateBps ? ` ${(order.taxRateBps / 100).toFixed(order.taxRateBps % 100 ? 2 : 1).replace(/\.0$/, "")}%` : "";
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{m(order.subtotalMinor)}</dd></div>
      {order.discountMinor > 0 && <div className="flex justify-between text-success"><dt>Discount{order.discountCode ? ` (${order.discountCode})` : ""}</dt><dd className="tabular-nums">−{m(order.discountMinor)}</dd></div>}
      <div className="flex justify-between"><dt>Delivery</dt><dd className="tabular-nums">{order.shippingMinor ? m(order.shippingMinor) : "Free"}</dd></div>
      {order.taxMinor > 0 && !order.taxIncluded && <div className="flex justify-between"><dt>{taxLabel}{rate}</dt><dd className="tabular-nums">{m(order.taxMinor)}</dd></div>}
      <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(order.totalMinor)}</dd></div>
      {order.taxMinor > 0 && order.taxIncluded && <div className="flex justify-between text-xs text-muted-foreground"><dt>Includes {taxLabel}{rate}</dt><dd className="tabular-nums">{m(order.taxMinor)}</dd></div>}
      {order.refundedMinor > 0 && (
        <>
          <div className="flex justify-between text-destructive"><dt>Refunded</dt><dd className="tabular-nums">−{m(order.refundedMinor)}</dd></div>
          <div className="flex justify-between font-medium"><dt>Net paid</dt><dd className="tabular-nums">{m(order.totalMinor - order.refundedMinor)}</dd></div>
        </>
      )}
    </dl>
  );
}
