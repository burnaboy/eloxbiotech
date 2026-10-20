import type { Order, OrderItem } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

export function OrderSummary({ order, showPv = false }: { order: Order & { items: OrderItem[] }; showPv?: boolean }) {
  const m = (v: number) => formatMoney(v, order.currency);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Items</CardTitle>
          <StatusBadge status={order.status} />
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {order.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-2">
              <span>{i.name} <span className="text-muted-foreground">× {i.quantity}{showPv ? ` · ${i.pv * i.quantity} PV` : ""}</span></span>
              <span className="tabular-nums">{m(i.unitPriceMinor * i.quantity)}</span>
            </div>
          ))}
          <div className="space-y-1 border-t pt-3">
            <div className="flex justify-between"><span>Subtotal</span><span>{m(order.subtotalMinor)}</span></div>
            <div className="flex justify-between"><span>Shipping</span><span>{order.shippingMinor ? m(order.shippingMinor) : "Free"}</span></div>
            <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{m(order.totalMinor)}</span></div>
          </div>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader><CardTitle>Delivery</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="font-medium">{order.shipName}</p>
          <p>{order.shipPhone}</p>
          <p>{order.shipLine1}{order.shipLine2 ? `, ${order.shipLine2}` : ""}</p>
          <p>{order.shipCity}, {order.shipState}</p>
          <p>{order.shipCountry} {order.shipPostal}</p>
          {order.trackingRef && <p className="pt-2">Tracking: <strong>{order.trackingRef}</strong></p>}
          <p className="pt-2 text-muted-foreground">Placed {formatDate(order.createdAt)}</p>
          {order.paidAt && <p className="text-muted-foreground">Paid {formatDate(order.paidAt)}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
