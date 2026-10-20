import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";
import { notify } from "./notify";

const body = z.string().trim().min(2).max(5000);

export async function openTicket(userId: string, input: { subject: string; body: string; orderId?: string }) {
  const subject = z.string().trim().min(3).max(150).parse(input.subject);
  const text = body.parse(input.body);
  if (input.orderId) {
    const o = await prisma.order.findFirst({ where: { id: input.orderId, userId } });
    if (!o) throw new AppError("Order not found.");
  }
  return prisma.supportTicket.create({
    data: { userId, subject, orderId: input.orderId || null, messages: { create: { authorId: userId, isStaff: false, body: text } } },
  });
}

export async function replyTicket(ticketId: string, authorId: string, isStaff: boolean, text: string) {
  const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  if (!isStaff && t.userId !== authorId) throw new AppError("Not found.", 404);
  if (t.status === "CLOSED" && !isStaff) throw new AppError("This ticket is closed. Please open a new one.");
  await prisma.supportMessage.create({ data: { ticketId, authorId, isStaff, body: body.parse(text) } });
  await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: isStaff ? "ANSWERED" : "OPEN" } });
  if (isStaff) await notify(t.userId, "Support replied", `We replied to "${t.subject}".`, `/support/${ticketId}`);
}

export async function closeTicket(ticketId: string) {
  await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: "CLOSED" } });
}
