import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { TicketThread } from "@/components/ticket-thread";
import { staffReplyAction } from "../../actions";

export default async function AdminTicket({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("SUPPORT");
  const { id } = await params;
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: { user: true, messages: { orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  return (
    <>
      <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{t.subject}</h1><StatusBadge status={t.status} /></div>
      <p className="text-sm text-muted-foreground">
        <Link className="text-primary underline" href={`/admin/users/${t.userId}`}>{t.user.name}</Link> ({t.user.email})
        {t.orderId && <> · <Link className="text-primary underline" href={`/admin/orders/${t.orderId}`}>related order</Link></>}
      </p>
      <Flash sp={await searchParams} />
      <TicketThread messages={t.messages} staffView />
      <form action={staffReplyAction.bind(null, t.id)} className="space-y-3">
        <label htmlFor="body" className="sr-only">Reply</label>
        <Textarea id="body" name="body" rows={4} required placeholder="Reply to the member" />
        <div className="flex items-center gap-4">
          <Button>Send reply</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="close" className="h-4 w-4" /> Close ticket after replying</label>
        </div>
      </form>
    </>
  );
}
