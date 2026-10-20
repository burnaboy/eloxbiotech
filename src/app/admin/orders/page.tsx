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
import { FilterBar } from "@/components/admin/filter-bar";
import { dateWhere, pageOf, parseRange, searchText } from "@/lib/admin-filters";

const STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED", "CANCELLED", "REFUNDED"];
const PAGE = 50;

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string; from?: string; to?: string }> }) {
  await requireAdmin("ORDERS");
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const q = searchText(sp.q);
  const created = dateWhere(parseRange(sp.from, sp.to));
  const where: Prisma.OrderWhereInput = {
    ...(created ? { createdAt: created } : {}),
    ...(STATUSES.includes(sp.status as OrderStatus) ? { status: sp.status as OrderStatus } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { shipName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const orders = await prisma.order.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <FilterBar sp={sp} search={{ placeholder: "Order number, email or name" }} exportReport="orders">
        <div className="space-y-1">
          <label htmlFor="status" className="block text-xs font-medium text-muted-foreground">Status</label>
          <Select id="status" name="status" defaultValue={sp.status ?? ""} className="w-48">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
          </Select>
        </div>
      </FilterBar>
      {orders.length === 0 ? <Empty>No orders match these filters.</Empty> : (
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
      <Pager page={page} hasMore={orders.length > PAGE} params={{ status: sp.status, q: sp.q, from: sp.from, to: sp.to }} />
    </>
  );
}
