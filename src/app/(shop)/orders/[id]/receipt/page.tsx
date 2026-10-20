import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/orders/${id}/receipt`);
  const isStaff = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const [order, brand] = await Promise.all([
    prisma.order.findFirst({ where: { id, ...(isStaff ? {} : { userId: user.id }) }, include: { items: true, payments: { where: { status: { in: ["SUCCEEDED", "REFUNDED"] } } } } }),
    getBrand(),
  ]);
  if (!order || !order.paidAt) notFound();
  const m = (v: number) => formatMoney(v, order.currency);
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
              <tr key={i.id} className="border-b"><td className="py-2">{i.name} <span className="text-muted-foreground">({i.sku})</span></td><td>{i.quantity}</td><td className="text-right">{m(i.unitPriceMinor)}</td><td className="text-right">{m(i.unitPriceMinor * i.quantity)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="pt-2 text-right">Subtotal</td><td className="pt-2 text-right">{m(order.subtotalMinor)}</td></tr>
            <tr><td colSpan={3} className="text-right">Shipping</td><td className="text-right">{m(order.shippingMinor)}</td></tr>
            <tr className="font-semibold"><td colSpan={3} className="text-right">Total paid</td><td className="text-right">{m(order.totalMinor)}</td></tr>
          </tfoot>
        </table>
        <p className="text-xs text-muted-foreground">Payment reference: {order.payments[0]?.providerRef ?? "—"} ({order.payments[0]?.provider ?? ""})</p>
      </div>
      <div className="mt-4 print:hidden"><PrintButton /></div>
    </div>
  );
}
