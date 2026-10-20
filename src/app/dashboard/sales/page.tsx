import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Attributed sales" };

export default async function SalesPage() {
  const user = await requireAffiliate();
  const [orders, brand] = await Promise.all([
    prisma.order.findMany({
      where: { referrerId: user.id, status: { not: "PENDING_PAYMENT" } },
      include: { user: { select: { name: true } }, commissions: { where: { userId: user.id, type: "DIRECT" } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    getBrand(),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Attributed sales</h1>
      <p className="text-sm text-muted-foreground">Orders from people you referred. Buyer names are shortened for privacy.</p>
      {orders.length === 0 ? <Empty>No attributed sales yet.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Order</Th><Th>Buyer</Th><Th>Status</Th><Th className="text-right">Subtotal</Th><Th className="text-right">PV</Th><Th>Your commission</Th></tr></THead>
          <TBody>
            {orders.map((o) => {
              const c = o.commissions[0];
              return (
                <tr key={o.id}>
                  <Td>{formatDate(o.paidAt ?? o.createdAt)}</Td>
                  <Td>{o.number}</Td>
                  <Td>{o.user.name.split(" ")[0]} {o.user.name.split(" ")[1]?.[0] ?? ""}.</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td className="text-right tabular-nums">{m(o.subtotalMinor)}</Td>
                  <Td className="text-right tabular-nums">{o.totalPv}</Td>
                  <Td>{c ? <span className="flex items-center gap-2"><StatusBadge status={c.status} /> {m(c.amountMinor)}</span> : <Badge>none</Badge>}</Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
