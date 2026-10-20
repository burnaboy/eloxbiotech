import Link from "next/link";
import { ConfirmAction } from "@/components/admin/high-risk";
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
import { cancelOrderAdminAction, deliverOrderAction, processingOrderAction, receiveReturnAction, refundExtraPaymentAction, refundOrderAction, retryRefundAction, shipOrderAction } from "../../actions";
import { LIVE_PAID } from "@/lib/order-state";
import { shippingRemaining } from "@/lib/refunds";

export default async function AdminOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("ORDERS");
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { id: "asc" } }, payments: { orderBy: { createdAt: "asc" } }, user: true, commissions: { include: { user: { select: { name: true } }, planVersion: { select: { version: true } } } }, returns: true, refunds: { orderBy: { createdAt: "asc" } }, planVersion: { select: { version: true } } },
  });
  if (!order) notFound();
  const [referrer, logs] = await Promise.all([
    order.referrerId ? prisma.user.findUnique({ where: { id: order.referrerId }, select: { id: true, name: true, referralCode: true } }) : null,
    prisma.auditLog.findMany({ where: { entity: "Order", entityId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  const m = (v: number) => formatMoney(v, order.currency);
  const paid = LIVE_PAID.includes(order.status);
  const left = order.totalMinor - order.refundedMinor;
  const shipLeft = shippingRemaining(order, order.items);
  const partly = order.status === "PARTIALLY_REFUNDED";
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
        {" "}· {order.totalPv - order.refundedPv} PV{order.refundedPv ? ` (${order.refundedPv} refunded)` : ""} {order.commissionedAt ? `· commissions approved ${formatDate(order.commissionedAt)}` : ""}
        {order.planVersion && ` · plan v${order.planVersion.version}`}
      </p>
      <OrderSummary order={order} showPv />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Fulfilment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {order.status === "PAID" && <form action={processingOrderAction.bind(null, order.id)}><Button variant="outline">Mark as being prepared</Button></form>}
            {(["PAID", "PROCESSING"].includes(order.status) || (partly && !order.shippedAt)) && (
              <form action={shipOrderAction.bind(null, order.id)} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input name="carrier" placeholder="Carrier (e.g. GIG Logistics)" aria-label="Carrier" />
                <Input name="trackingRef" placeholder="Tracking reference" aria-label="Tracking reference" />
                <Button>Mark shipped</Button>
              </form>
            )}
            {(order.status === "SHIPPED" || (partly && order.shippedAt && !order.deliveredAt)) && <form action={deliverOrderAction.bind(null, order.id)}><Button>Mark delivered</Button></form>}
            {order.status === "PENDING_PAYMENT" && <ConfirmAction id="cancel" action={cancelOrderAdminAction.bind(null, order.id)} label="Cancel and release stock" confirm="CANCEL" description="Only for an unpaid order. If a payment arrives later it is flagged for a refund." />}
            {!paid && order.status !== "PENDING_PAYMENT" && <p className="text-sm text-muted-foreground">No fulfilment actions for a {order.status.toLowerCase()} order.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Refund</CardTitle></CardHeader>
          <CardContent>
            {paid && order.disputedAt && <Alert tone="error">A payment dispute is open. Refunds wait until it's resolved.</Alert>}
            {paid && !order.disputedAt ? (
              <form action={refundOrderAction.bind(null, order.id)} className="space-y-3 text-sm">
                <p>{m(left)} left to refund. Amounts are worked out from what the customer paid for each item (after discount, with VAT), and related commissions are recalculated. Needs a fresh authenticator code.</p>
                <fieldset className="space-y-2">
                  <legend className="sr-only">What to refund</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="scope" value="full" defaultChecked className="h-4 w-4" /> Everything not yet refunded ({m(left)})</label>
                  <label className="flex items-center gap-2"><input type="radio" name="scope" value="part" className="h-4 w-4" /> Only these items:</label>
                  <table className="ml-6 w-[calc(100%-1.5rem)]">
                    <tbody>
                      {order.items.map((i) => {
                        const open = i.quantity - i.refundedQty;
                        return (
                          <tr key={i.id}>
                            <td className="py-1">{i.name}{i.variantName ? ` (${i.variantName})` : ""} <span className="text-muted-foreground">{open} of {i.quantity} left</span></td>
                            <td><Input name={`qty_${i.id}`} inputMode="numeric" className="w-20" aria-label={`Units of ${i.name} to refund`} disabled={open === 0} placeholder="0" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {shipLeft > 0 && <label className="ml-6 flex items-center gap-2"><input type="checkbox" name="shipping" className="h-4 w-4" /> Also refund the delivery charge ({m(shipLeft)})</label>}
                </fieldset>
                <Input name="reason" placeholder="Reason" aria-label="Reason" required />
                <p className="text-muted-foreground">{order.shippedAt ? "This order has shipped, so nothing goes back to stock now. Record returned goods below once they arrive and are inspected." : "This order hasn't shipped, so refunded items go straight back to stock."}</p>
                <Input name="confirm" placeholder="Type REFUND to confirm" aria-label="Confirmation" />
                <Button variant="destructive">Refund</Button>
              </form>
            ) : !paid && <p className="text-sm text-muted-foreground">{order.status === "REFUNDED" ? "Fully refunded." : "Only paid orders can be refunded."}</p>}
            {order.refunds.length > 0 && (
              <div className="mt-4 space-y-2 border-t pt-3 text-sm">
                <p className="font-medium">Refunds</p>
                {order.refunds.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{formatDate(r.createdAt)} · {m(r.amountMinor)} · {r.reason} <span className="text-muted-foreground">({r.source})</span>{r.failureReason && <span className="block text-xs text-destructive">{r.failureReason}</span>}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === "FAILED" && <ConfirmAction id={`retry-${r.id}`} action={retryRefundAction.bind(null, order.id, r.id)} label="Retry" size="sm" description="Check the payment provider's dashboard first, so the customer isn't refunded twice." />}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {["REFUNDED", "PARTIALLY_REFUNDED"].includes(order.status) && order.shippedAt && order.items.some((i) => i.refundedQty > i.restockedQty + i.writtenOffQty) && (
        <Card>
          <CardHeader><CardTitle>Returned goods</CardTitle></CardHeader>
          <CardContent>
            <form action={receiveReturnAction.bind(null, order.id)} className="space-y-3 text-sm">
              <p className="text-muted-foreground">When returned items arrive, restock the ones fit to resell and write off the rest. Each unit can only be recorded once.</p>
              <table className="w-full">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Item</th><th>Still to record</th><th>Restock</th><th>Write off</th></tr></thead>
                <tbody>
                  {order.items.map((i) => {
                    const open = i.refundedQty - i.restockedQty - i.writtenOffQty;
                    return (
                      <tr key={i.id}>
                        <td className="py-1">{i.name}{i.variantName ? ` (${i.variantName})` : ""}</td>
                        <td className="tabular-nums">{open}</td>
                        <td><Input name={`restock_${i.id}`} inputMode="numeric" className="w-20" aria-label={`Restock ${i.name}`} disabled={open === 0} defaultValue="" /></td>
                        <td><Input name={`writeoff_${i.id}`} inputMode="numeric" className="w-20" aria-label={`Write off ${i.name}`} disabled={open === 0} defaultValue="" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Input name="note" placeholder="Inspection note (optional)" aria-label="Inspection note" />
              <Button>Record returned goods</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {order.payments.length === 0 && <p className="text-muted-foreground">No payment attempts.</p>}
          {order.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
              <span>{p.provider} · <code>{p.providerRef}</code></span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={p.status === "SUCCEEDED" ? "success" : p.status === "PENDING" ? "warning" : "danger"}>{p.status.toLowerCase().replace("_", " ")}</Badge> {m(p.amountMinor)} · {formatDate(p.createdAt)}
                {p.id === order.paidPaymentId && <Badge tone="primary">paid this order</Badge>}
                {p.status === "SUCCEEDED" && p.id !== order.paidPaymentId && <ConfirmAction id={`extra-${p.id}`} action={refundExtraPaymentAction.bind(null, order.id, p.id)} label="Give back extra payment" confirm="REFUND" size="sm" variant="destructive" />}
              </span>
              {p.failureReason && <span className="w-full text-xs text-muted-foreground">{p.failureReason}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Commissions on this order</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {order.commissions.length === 0 ? <p className="text-muted-foreground">None.</p> : order.commissions.map((c) => (
            <div key={c.id} className="flex flex-wrap justify-between gap-2">
              <span>{c.user.name} · {c.type.toLowerCase()} <StatusBadge status={c.status} />
                {c.rateBps !== null && c.baseMinor !== null && <span className="block text-xs text-muted-foreground">floor({m(c.baseMinor)} × {c.rateBps} bps / 10000){c.planVersion ? ` · plan v${c.planVersion.version}` : ""}</span>}
              </span>
              <span className="tabular-nums">{m(c.amountMinor - c.reversedMinor)}{c.reversedMinor > 0 && <span className="block text-xs text-muted-foreground">{m(c.reversedMinor)} reversed</span>}</span>
            </div>
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
