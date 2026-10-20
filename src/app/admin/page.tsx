import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { Stat } from "@/components/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Flash } from "@/components/flash";
import { RevenueChart, StatusChart } from "@/components/admin-charts";

export const metadata = { title: "Admin" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin();
  const brand = await getBrand();
  const since = new Date(Date.now() - 30 * 864e5);
  const [revenue, commissions, byStatus, affiliates, customers, pendingPayouts, openReturns, openTickets, lowStock, daily] = await Promise.all([
    prisma.order.aggregate({ where: { paidAt: { gte: since }, status: { in: ["PAID", "SHIPPED", "DELIVERED"] } }, _sum: { totalMinor: true, subtotalMinor: true }, _count: true }),
    prisma.commission.aggregate({ where: { createdAt: { gte: since }, status: { not: "REVERSED" } }, _sum: { amountMinor: true } }),
    prisma.order.groupBy({ by: ["status"], _count: true }),
    prisma.user.count({ where: { role: "AFFILIATE" } }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.payout.aggregate({ where: { status: { in: ["REQUESTED", "APPROVED"] } }, _sum: { amountMinor: true }, _count: true }),
    prisma.returnRequest.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Product" p WHERE p.status = 'ACTIVE' AND (
      (NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v.active) AND p.stock <= p."lowStockThreshold")
      OR EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v.active AND v.stock <= COALESCE(v."lowStockThreshold", p."lowStockThreshold")))`,
    prisma.$queryRaw<{ day: Date; revenue: bigint; commissions: bigint }[]>`
      WITH days AS (SELECT generate_series(date_trunc('day', now() - interval '29 days'), date_trunc('day', now()), interval '1 day') AS day)
      SELECT d.day,
        COALESCE((SELECT SUM("totalMinor") FROM "Order" o WHERE date_trunc('day', o."paidAt") = d.day AND o.status IN ('PAID','SHIPPED','DELIVERED')), 0)::bigint AS revenue,
        COALESCE((SELECT SUM("amountMinor") FROM "Commission" c WHERE date_trunc('day', c."createdAt") = d.day AND c.status <> 'REVERSED'), 0)::bigint AS commissions
      FROM days d ORDER BY d.day`,
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const rev = revenue._sum.totalMinor ?? 0;
  const comm = commissions._sum.amountMinor ?? 0;
  const payoutRatio = (revenue._sum.subtotalMinor ?? 0) > 0 ? ((comm / (revenue._sum.subtotalMinor ?? 1)) * 100).toFixed(1) : "0";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <Flash sp={await searchParams} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue, last 30 days" value={m(rev)} hint={`${revenue._count} paid orders`} />
        <Stat label="Commissions, last 30 days" value={m(comm)} hint={`${payoutRatio}% of product sales`} />
        <Stat label="Members" value={(affiliates + customers).toLocaleString()} hint={`${affiliates} affiliates · ${customers} customers`} />
        <Stat label="Payouts waiting" value={m(pendingPayouts._sum.amountMinor ?? 0)} hint={`${pendingPayouts._count} request(s)`} />
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/admin/returns" className="rounded-md border bg-card px-3 py-2 hover:bg-muted">{openReturns} open return(s)</Link>
        <Link href="/admin/support" className="rounded-md border bg-card px-3 py-2 hover:bg-muted">{openTickets} open ticket(s)</Link>
        <Link href="/admin/products?low=1" className="rounded-md border bg-card px-3 py-2 hover:bg-muted">{Number(lowStock[0]?.n ?? 0)} low-stock product(s)</Link>
        <Link href="/admin/risk" className="rounded-md border bg-card px-3 py-2 hover:bg-muted">Risk & reconciliation</Link>
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Revenue and commissions, last 30 days</CardTitle></CardHeader>
          <CardContent>
            <RevenueChart currency={brand.currency} data={daily.map((d) => ({ day: d.day.toISOString().slice(5, 10), revenue: Number(d.revenue) / 100, commissions: Number(d.commissions) / 100 }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Orders by status</CardTitle></CardHeader>
          <CardContent><StatusChart data={byStatus.map((s) => ({ status: s.status.replace("_PAYMENT", "").toLowerCase(), count: s._count }))} /></CardContent>
        </Card>
      </div>
    </>
  );
}
