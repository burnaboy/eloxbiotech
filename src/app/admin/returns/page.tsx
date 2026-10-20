import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { resolveReturnAction } from "../actions";

export default async function AdminReturns({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; all?: string }> }) {
  await requireAdmin("ORDERS");
  const sp = await searchParams;
  const list = await prisma.returnRequest.findMany({
    where: sp.all ? {} : { status: { in: ["REQUESTED", "APPROVED"] } },
    include: { order: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Returns</h1>
        <Link href={sp.all ? "?" : "?all=1"} className="text-sm text-primary underline">{sp.all ? "Show open only" : "Show all"}</Link>
      </div>
      <Flash sp={sp} />
      {list.length === 0 ? <Empty>No return requests.</Empty> : list.map((r) => (
        <Card key={r.id} className="space-y-3 p-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p><Link href={`/admin/orders/${r.orderId}`} className="font-medium text-primary underline">{r.order.number}</Link> · {r.user.name} ({r.user.email}) · {formatMoney(r.order.totalMinor, r.order.currency)}</p>
            <span className="flex items-center gap-2"><StatusBadge status={r.status} /><span className="text-muted-foreground">{formatDate(r.createdAt)}</span></span>
          </div>
          <p className="rounded-md bg-muted p-3">{r.reason}</p>
          {r.adminNote && <p>Note: {r.adminNote}</p>}
          {["REQUESTED", "APPROVED"].includes(r.status) && (
            <div className="flex flex-wrap gap-3">
              {r.status === "REQUESTED" && (
                <form action={resolveReturnAction.bind(null, r.id, "APPROVE")} className="flex gap-2">
                  <Input name="note" placeholder="Return instructions for the customer" className="w-72" aria-label="Instructions" />
                  <Button variant="outline">Approve return</Button>
                </form>
              )}
              <form action={resolveReturnAction.bind(null, r.id, "REFUND")} className="flex items-center gap-2">
                <label className="flex items-center gap-1"><input type="checkbox" name="restock" className="h-4 w-4" /> Restock</label>
                <Button>Refund now</Button>
              </form>
              <form action={resolveReturnAction.bind(null, r.id, "REJECT")} className="flex gap-2">
                <Input name="note" placeholder="Reason for rejecting" className="w-56" aria-label="Rejection reason" />
                <Button variant="ghost" className="text-destructive">Reject</Button>
              </form>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
