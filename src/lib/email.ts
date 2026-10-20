import { prisma, type Tx } from "./db";

/**
 * Outbox pattern: emails are written to EmailOutbox inside the same transaction as the change
 * that caused them, then delivered by `deliverPendingEmails` (cron) or straight away by `sendEmail`.
 * EMAIL_PROVIDER=log (default) keeps mail on the server, which is right for development.
 */
export async function queueEmail(to: string, subject: string, body: string, tx: Tx = prisma) {
  return tx.emailOutbox.create({ data: { to, subject, body } });
}

export async function sendEmail(to: string, subject: string, body: string) {
  const row = await queueEmail(to, subject, body);
  await deliverOne(row.id);
}

export async function deliverPendingEmails(limit = 100) {
  const rows = await prisma.emailOutbox.findMany({ where: { sentAt: null, error: null }, orderBy: { createdAt: "asc" }, take: limit });
  for (const r of rows) await deliverOne(r.id);
  return rows.length;
}

async function deliverOne(id: string) {
  const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
  if (row.sentAt) return;
  try {
    await deliver(row.to, row.subject, row.body);
    await prisma.emailOutbox.update({ where: { id }, data: { sentAt: new Date() } });
  } catch (e) {
    await prisma.emailOutbox.update({ where: { id }, data: { error: e instanceof Error ? e.message : String(e) } });
  }
}

async function deliver(to: string, subject: string, _body: string) {
  const provider = process.env.EMAIL_PROVIDER ?? "log";
  if (provider === "log") {
    if (process.env.NODE_ENV === "development") console.info(`[email] to=${to} subject="${subject}" (stored in EmailOutbox)`);
    return;
  }
  throw new Error(`Email provider "${provider}" is not configured`);
}
