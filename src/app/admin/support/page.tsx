import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { contactHandledAction } from "../actions";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pager } from "@/components/admin/pager";
import { dateWhere, pageOf, parseRange, searchText } from "@/lib/admin-filters";
import type { Prisma } from "@prisma/client";

const PAGE = 50;

export default async function AdminSupport({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; all?: string; q?: string; from?: string; to?: string; page?: string }> }) {
  await requireAdmin("SUPPORT");
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const q = searchText(sp.q);
  const created = dateWhere(parseRange(sp.from, sp.to));
  const where: Prisma.SupportTicketWhereInput = {
    ...(sp.all ? {} : { status: { not: "CLOSED" } }),
    ...(created ? { createdAt: created } : {}),
    ...(q ? { OR: [{ subject: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { orderId: q }] } : {}),
  };
  const [tickets, contacts] = await Promise.all([
    prisma.supportTicket.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { updatedAt: "asc" }, skip: (page - 1) * PAGE, take: PAGE + 1 }),
    prisma.contactMessage.findMany({ where: { handled: false }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <Link href={sp.all ? "?" : "?all=1"} className="text-sm text-primary underline">{sp.all ? "Hide closed" : "Show closed"}</Link>
      </div>
      <Flash sp={sp} />
      <FilterBar sp={sp} search={{ placeholder: "Subject, member email or order id" }}>
        {sp.all && <input type="hidden" name="all" value="1" />}
      </FilterBar>
      {tickets.length === 0 ? <Empty>{q || created ? "No tickets match these filters." : "No open tickets. Nice."}</Empty> : (
        <Table>
          <THead><tr><Th>Subject</Th><Th>Member</Th><Th>Status</Th><Th>Last update</Th></tr></THead>
          <TBody>
            {tickets.slice(0, PAGE).map((t) => (
              <tr key={t.id}>
                <Td><Link href={`/admin/support/${t.id}`} className="font-medium text-primary hover:underline">{t.subject}</Link></Td>
                <Td>{t.user.name}<span className="block text-xs text-muted-foreground">{t.user.email}</span></Td>
                <Td><StatusBadge status={t.status} /></Td>
                <Td>{formatDate(t.updatedAt)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={tickets.length > PAGE} params={{ all: sp.all, q: sp.q, from: sp.from, to: sp.to }} />
      <Card>
        <CardHeader><CardTitle>Contact form messages ({contacts.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {contacts.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
          {contacts.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{c.subject}</p><span className="text-muted-foreground">{formatDate(c.createdAt)}</span></div>
              <p className="text-muted-foreground">{c.name} · <a className="text-primary underline" href={`mailto:${c.email}`}>{c.email}</a> {c.phone && `· ${c.phone}`}</p>
              <p className="mt-2 whitespace-pre-line">{c.body}</p>
              <form action={contactHandledAction.bind(null, c.id)} className="mt-2"><Button size="sm" variant="outline">Mark handled</Button></form>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
