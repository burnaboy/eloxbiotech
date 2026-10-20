import { prisma, type Tx } from "./db";
import { queueEmail } from "./email";

/** "account" emails (security, payouts) always go out; the others follow the member's preferences. */
export type NotifyCategory = "order" | "commission" | "account";

export async function notify(userId: string, title: string, body: string, link?: string, tx: Tx = prisma, category: NotifyCategory = "account") {
  await tx.notification.create({ data: { userId, title, body, link } });
  const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, emailOrderUpdates: true, emailCommissionUpdates: true } });
  if (!u?.emailVerifiedAt) return;
  if (category === "order" && !u.emailOrderUpdates) return;
  if (category === "commission" && !u.emailCommissionUpdates) return;
  const url = link ? `\n\n${process.env.APP_URL ?? ""}${link}` : "";
  await queueEmail(u.email, title, `${body}${url}`, tx);
}
