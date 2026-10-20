import Link from "next/link";
import type { OrderStatus, Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Pager } from "@/components/admin/pager";

const STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];
const PAGE = 50;

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  await requireAdmin("ORDERS");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.OrderWhereInput = {
    ...(STATUSES.includes(sp.status as OrderStatus) ? { status: sp.status as OrderStatus } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { user: { email: { contains: sp.q, mode: "insensitive" } } }, { shipName: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const orders = await prisma.order.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Order number, email or name" className="max-w-xs" aria-label="Search orders" />
        <Select name="status" defaultValue={sp.status ?? ""} className="max-w-48" aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
        </Select>
        <Button variant="outline">Filter</Button>
      </form>
      {orders.length === 0 ? <Empty>No orders.</Empty> : (
        <Table>
          <THead><tr><Th>Order</Th><Th>Customer</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></THead>
          <TBody>
            {orders.slice(0, PAGE).map((o) => (
              <tr key={o.id}>
                <Td><Link href={`/admin/orders/${o.id}`} className="font-medium text-primary hover:underline">{o.number}</Link></Td>
                <Td>{o.user.name}<span className="block text-xs text-muted-foreground">{o.user.email}</span></Td>
                <Td>{formatDate(o.createdAt)}</Td>
                <Td><StatusBadge status={o.status} />{o.disputedAt && <Badge tone="danger" className="ml-1">disputed</Badge>}</Td>
                <Td className="text-right tabular-nums">{formatMoney(o.totalMinor, o.currency)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={orders.length > PAGE} params={{ status: sp.status, q: sp.q }} />
    </>
  );
}
