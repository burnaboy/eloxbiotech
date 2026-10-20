import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { TicketThread } from "@/components/ticket-thread";
import { replyTicketAction } from "../actions";

export const metadata = { title: "Support request" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/support/${id}`);
  const t = await prisma.supportTicket.findFirst({ where: { id, userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  return (
    <div className="container max-w-3xl space-y-6 py-10">
      <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{t.subject}</h1><Badge>{t.status.toLowerCase()}</Badge></div>
      <Flash sp={await searchParams} />
      <TicketThread messages={t.messages} />
      {t.status !== "CLOSED" && (
        <form action={replyTicketAction.bind(null, t.id)} className="space-y-3">
          <label htmlFor="body" className="sr-only">Reply</label>
          <Textarea id="body" name="body" required rows={4} placeholder="Write a reply" />
          <Button>Send reply</Button>
        </form>
      )}
    </div>
  );
}
