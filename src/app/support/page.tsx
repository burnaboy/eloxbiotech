import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Support" };

export default async function SupportPage() {
  const user = await requireUser("/support");
  const tickets = await prisma.supportTicket.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
  return (
    <div className="container max-w-4xl space-y-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <Button asChild><Link href="/support/new">New request</Link></Button>
      </div>
      {tickets.length === 0 ? <Empty>No support requests.</Empty> : (
        <Table>
          <THead><tr><Th>Subject</Th><Th>Status</Th><Th>Updated</Th></tr></THead>
          <TBody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <Td><Link href={`/support/${t.id}`} className="font-medium text-primary hover:underline">{t.subject}</Link></Td>
                <Td><Badge tone={t.status === "ANSWERED" ? "primary" : t.status === "OPEN" ? "warning" : "neutral"}>{t.status.toLowerCase()}</Badge></Td>
                <Td>{formatDate(t.updatedAt)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
