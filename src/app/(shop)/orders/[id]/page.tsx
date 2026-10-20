import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { OrderSummary } from "@/components/order-summary";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cancelOrderAction, payOrderAction, requestReturnAction } from "../../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import Link from "next/link";
import { Check } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Order" };

function Timeline({ order }: { order: { createdAt: Date; paidAt: Date | null; shippedAt: Date | null; deliveredAt: Date | null; status: string; carrier: string | null; trackingRef: string | null } }) {
  const steps = [
    { label: "Order placed", at: order.createdAt },
    { label: "Payment confirmed", at: order.paidAt },
    { label: `Shipped${order.carrier ? ` with ${order.carrier}` : ""}${order.trackingRef ? ` · tracking ${order.trackingRef}` : ""}`, at: order.shippedAt },
    { label: "Delivered", at: order.deliveredAt },
  ];
  return (
    <ol className="space-y-3" aria-label="Delivery progress">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-3 text-sm">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${s.at ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {s.at ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          </span>
          <span className={s.at ? "" : "text-muted-foreground"}>{s.label}</span>
          {s.at && <span className="ml-auto text-xs text-muted-foreground">{formatDate(s.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; paid?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/orders/${id}`);
  const order = await prisma.order.findFirst({ where: { id, userId: user.id }, include: { items: true, returns: { orderBy: { createdAt: "desc" } } } });
  if (!order) notFound();
  const pending = order.status === "PENDING_PAYMENT" && order.expiresAt > new Date();
  return (
    <div className="container space-y-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Order {order.number}</h1>
      {sp.error && <Alert tone="error">{sp.error}</Alert>}
      {sp.ok && <Alert tone="success">{sp.ok}</Alert>}
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
      {["PAID", "SHIPPED", "DELIVERED", "REFUNDED"].includes(order.status) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Delivery progress</CardTitle>
              <Button asChild variant="outline" size="sm"><Link href={`/orders/${order.id}/receipt`}>Receipt</Link></Button>
            </CardHeader>
            <CardContent><Timeline order={order} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Returns and help</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {order.returns.map((r) => (
                <div key={r.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between"><span>Return request</span><StatusBadge status={r.status} /></div>
                  <p className="text-muted-foreground">{r.reason}</p>
                  {r.adminNote && <p className="mt-1">Response: {r.adminNote}</p>}
                </div>
              ))}
              {["PAID", "SHIPPED", "DELIVERED"].includes(order.status) && !order.returns.some((r) => ["REQUESTED", "APPROVED"].includes(r.status)) && (
                <form action={requestReturnAction.bind(null, order.id)} className="space-y-2">
                  <label htmlFor="reason" className="font-medium">Request a return or refund</label>
                  <Textarea id="reason" name="reason" required minLength={10} rows={3} placeholder="What went wrong?" />
                  <Button variant="outline" size="sm">Submit request</Button>
                </form>
              )}
              <p><Link href={`/support/new?order=${order.id}`} className="text-primary underline">Contact support about this order</Link></p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
