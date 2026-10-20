import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { OrderSummary } from "@/components/order-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Flash } from "@/components/flash";
import { cancelOrderAdminAction, deliverOrderAction, refundOrderAction, shipOrderAction } from "../../actions";

export default async function AdminOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("ORDERS");
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, payments: { orderBy: { createdAt: "asc" } }, user: true, commissions: { include: { user: { select: { name: true } } } }, returns: true },
  });
  if (!order) notFound();
  const [referrer, logs] = await Promise.all([
    order.referrerId ? prisma.user.findUnique({ where: { id: order.referrerId }, select: { id: true, name: true, referralCode: true } }) : null,
    prisma.auditLog.findMany({ where: { entity: "Order", entityId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  const m = (v: number) => formatMoney(v, order.currency);
  const paid = ["PAID", "SHIPPED", "DELIVERED"].includes(order.status);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Order {order.number}</h1>
        {order.disputedAt && <Badge tone="danger">dispute open since {formatDate(order.disputedAt)}</Badge>}
        {order.paidAt && <Button asChild variant="outline" size="sm"><Link href={`/orders/${order.id}/receipt`}>Receipt</Link></Button>}
      </div>
      <Flash sp={await searchParams} />
      <p className="text-sm text-muted-foreground">
        Customer: <Link className="text-primary underline" href={`/admin/users/${order.userId}`}>{order.user.name}</Link> ({order.user.email})
        {referrer && <> · Referred by <Link className="text-primary underline" href={`/admin/users/${referrer.id}`}>{referrer.name}</Link> ({referrer.referralCode})</>}
        {" "}· {order.totalPv} PV {order.commissionedAt ? `· commissions approved ${formatDate(order.commissionedAt)}` : ""}
      </p>
      <OrderSummary order={order} showPv />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Fulfilment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {order.status === "PAID" && (
              <form action={shipOrderAction.bind(null, order.id)} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input name="carrier" placeholder="Carrier (e.g. GIG Logistics)" aria-label="Carrier" />
                <Input name="trackingRef" placeholder="Tracking reference" aria-label="Tracking reference" />
                <Button>Mark shipped</Button>
              </form>
            )}
            {order.status === "SHIPPED" && <form action={deliverOrderAction.bind(null, order.id)}><Button>Mark delivered</Button></form>}
            {order.status === "PENDING_PAYMENT" && <form action={cancelOrderAdminAction.bind(null, order.id)}><Button variant="outline">Cancel and release stock</Button></form>}
            {!paid && order.status !== "PENDING_PAYMENT" && <p className="text-sm text-muted-foreground">No fulfilment actions for a {order.status.toLowerCase()} order.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Refund</CardTitle></CardHeader>
          <CardContent>
            {paid ? (
              <form action={refundOrderAction.bind(null, order.id)} className="space-y-3 text-sm">
                <Alert>Refunds {m(order.totalMinor)} through {order.payments.find((p) => p.status === "SUCCEEDED")?.provider ?? "the gateway"} and reverses related commissions. Needs a fresh authenticator code.</Alert>
                <Input name="reason" placeholder="Reason" aria-label="Reason" required />
                <label className="flex items-center gap-2"><input type="checkbox" name="restock" className="h-4 w-4" /> Return items to stock</label>
                <Input name="confirm" placeholder='Type REFUND to confirm' aria-label="Confirmation" />
                <Button variant="destructive">Refund order</Button>
              </form>
            ) : <p className="text-sm text-muted-foreground">Only paid orders can be refunded.</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {order.payments.length === 0 && <p className="text-muted-foreground">No payment attempts.</p>}
          {order.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
              <span>{p.provider} · <code>{p.providerRef}</code></span>
              <span><Badge tone={p.status === "SUCCEEDED" ? "success" : p.status === "PENDING" ? "warning" : "danger"}>{p.status.toLowerCase()}</Badge> {m(p.amountMinor)} · {formatDate(p.createdAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Commissions on this order</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {order.commissions.length === 0 ? <p className="text-muted-foreground">None.</p> : order.commissions.map((c) => (
            <div key={c.id} className="flex justify-between"><span>{c.user.name} · {c.type.toLowerCase()} <StatusBadge status={c.status} /></span><span className="tabular-nums">{m(c.amountMinor)}</span></div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-1 text-sm">{logs.map((l) => <li key={l.id}><span className="text-muted-foreground">{formatDate(l.createdAt)}</span> · {l.action}</li>)}</ol>
        </CardContent>
      </Card>
    </>
  );
}
