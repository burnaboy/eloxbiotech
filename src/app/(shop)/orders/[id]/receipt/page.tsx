import { notFound } from "next/navigation";
import { canAccess, requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getShopSettings } from "@/lib/settings";
import { OrderTotals } from "@/components/order-totals";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/orders/${id}/receipt`);
  // Staff can open any receipt only with the Orders permission.
  const isStaff = canAccess(user, "ORDERS");
  const [order, brand, shop] = await Promise.all([
    prisma.order.findFirst({ where: { id, ...(isStaff ? {} : { userId: user.id }) }, include: { items: true, payments: true, refunds: { where: { status: "PROCESSED" }, orderBy: { createdAt: "asc" } } } }),
    getBrand(),
    getShopSettings(),
  ]);
  if (!order || !order.paidAt) notFound();
  const m = (v: number) => formatMoney(v, order.currency);
  const payment = order.payments.find((p) => p.id === order.paidPaymentId);
  return (
    <div className="container max-w-2xl py-10 print:py-0">
      <div className="space-y-6 rounded-lg border bg-card p-8 print:border-0">
        <div className="flex justify-between">
          <div>
            <p className="text-xl font-semibold">{brand.companyName}</p>
            <p className="text-sm text-muted-foreground">{brand.supportEmail} {brand.supportPhone}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">RECEIPT</p>
            <p>{order.number}</p>
            <p>Paid {formatDate(order.paidAt)}</p>
            {order.status === "REFUNDED" && <p className="font-semibold text-destructive">REFUNDED</p>}
            {order.status === "PARTIALLY_REFUNDED" && <p className="font-semibold text-destructive">PARTLY REFUNDED</p>}
          </div>
        </div>
        <div className="text-sm">
          <p className="font-medium">Billed to</p>
          <p>{order.shipName}, {order.shipPhone}</p>
          <p>{order.shipLine1}{order.shipLine2 ? `, ${order.shipLine2}` : ""}, {order.shipCity}, {order.shipState}, {order.shipCountry}</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left"><tr><th className="py-2">Item</th><th>Qty</th><th className="text-right">Unit</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id} className="border-b"><td className="py-2">{i.name}{i.variantName ? ` (${i.variantName})` : ""} <span className="text-muted-foreground">({i.sku})</span></td><td>{i.quantity}</td><td className="text-right">{m(i.unitPriceMinor)}</td><td className="text-right">{m(i.unitPriceMinor * i.quantity)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto max-w-xs"><OrderTotals order={order} taxLabel={shop.taxLabel} /></div>
        {order.refunds.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">Refunds</p>
            {order.refunds.map((r) => <p key={r.id}>{formatDate(r.processedAt ?? r.createdAt)}: {m(r.amountMinor)} ({r.reason})</p>)}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Payment reference: {payment?.providerRef ?? "—"}{payment ? ` (${payment.provider})` : ""}</p>
      </div>
      <div className="mt-4 print:hidden"><PrintButton /></div>
    </div>
  );
}
