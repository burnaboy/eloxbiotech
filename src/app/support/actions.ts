"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { runAction, str } from "@/lib/action";
import { openTicket, replyTicket } from "@/lib/support";

export async function openTicketAction(fd: FormData) {
  const user = await requireUser("/support/new");
  let id = "";
  const res = await runAction(async () => {
    id = (await openTicket(user.id, { subject: str(fd, "subject"), body: str(fd, "body"), orderId: str(fd, "orderId") || undefined })).id;
  });
  if (res?.error) redirect(`/support/new?error=${encodeURIComponent(res.error)}`);
  redirect(`/support/${id}`);
}

export async function replyTicketAction(ticketId: string, fd: FormData) {
  const user = await requireUser("/support");
  const res = await runAction(() => replyTicket(ticketId, user.id, false, str(fd, "body")));
  revalidatePath(`/support/${ticketId}`);
  redirect(`/support/${ticketId}${res?.error ? `?error=${encodeURIComponent(res.error)}` : ""}`);
}
