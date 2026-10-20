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

export default async function AdminSupport({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; all?: string }> }) {
  await requireAdmin("SUPPORT");
  const sp = await searchParams;
  const [tickets, contacts] = await Promise.all([
    prisma.supportTicket.findMany({ where: sp.all ? {} : { status: { not: "CLOSED" } }, include: { user: { select: { name: true, email: true } } }, orderBy: { updatedAt: "asc" }, take: 200 }),
    prisma.contactMessage.findMany({ where: { handled: false }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <Link href={sp.all ? "?" : "?all=1"} className="text-sm text-primary underline">{sp.all ? "Hide closed" : "Show closed"}</Link>
      </div>
      <Flash sp={sp} />
      {tickets.length === 0 ? <Empty>No open tickets.</Empty> : (
        <Table>
          <THead><tr><Th>Subject</Th><Th>Member</Th><Th>Status</Th><Th>Last update</Th></tr></THead>
          <TBody>
            {tickets.map((t) => (
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
