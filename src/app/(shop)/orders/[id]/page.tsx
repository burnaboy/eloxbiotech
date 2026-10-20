import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { OrderSummary } from "@/components/order-summary";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cancelOrderAction, payOrderAction } from "../../actions";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; paid?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/orders/${id}`);
  const order = await prisma.order.findFirst({ where: { id, userId: user.id }, include: { items: true } });
  if (!order) notFound();
  const pending = order.status === "PENDING_PAYMENT" && order.expiresAt > new Date();
  return (
    <div className="container space-y-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Order {order.number}</h1>
      {sp.error && <Alert tone="error">{sp.error}</Alert>}
      {order.status === "PAID" && sp.paid && <Alert tone="success">Payment received. Thank you! We'll let you know when it ships.</Alert>}
      {sp.paid === "pending" && order.status === "PENDING_PAYMENT" && <Alert>We're waiting for confirmation from the payment provider. This page will update once it arrives.</Alert>}
      {pending && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
          <p className="flex-1 text-sm">Awaiting payment. Items are reserved until {formatDate(order.expiresAt)}.</p>
          <form action={payOrderAction.bind(null, order.id)}><Button>Pay now</Button></form>
          <form action={cancelOrderAction.bind(null, order.id)}><Button variant="outline">Cancel order</Button></form>
        </div>
      )}
      <OrderSummary order={order} showPv={user.role !== "CUSTOMER"} />
    </div>
  );
}
