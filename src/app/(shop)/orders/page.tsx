import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const user = await requireUser("/orders");
  const orders = await prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="container py-10">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Your orders</h1>
      {orders.length === 0 ? <Empty>No orders yet.</Empty> : (
        <Table>
          <THead><tr><Th>Order</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></THead>
          <TBody>
            {orders.map((o) => (
              <tr key={o.id}>
                <Td><Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">{o.number}</Link></Td>
                <Td>{formatDate(o.createdAt)}</Td>
                <Td><StatusBadge status={o.status} /></Td>
                <Td className="text-right tabular-nums">{formatMoney(o.totalMinor, o.currency)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
