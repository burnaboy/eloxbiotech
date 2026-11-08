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

/** Parallel sends per job run. Each send holds one database connection, so keep this well under the pool size. */
const SEND_CONCURRENCY = 4;
/** The job runs every minute; stop picking up new work before the next run starts. */
const SEND_BUDGET_MS = 45_000;

/**
 * Sends queued emails, a few at a time, until the queue is empty, `limit` is reached or the time budget runs out.
 * The rest wait for the next run. Overlapping runs are safe (see deliverOne).
 */
export async function deliverPendingEmails(limit = 2000) {
  const started = Date.now();
  let sent = 0;
  let tried = 0;
  const skipped = new Set<string>(); // failed, or being sent by an overlapping run
  while (tried < limit && Date.now() - started < SEND_BUDGET_MS) {
    const rows = await prisma.emailOutbox.findMany({
      where: { sentAt: null, error: null, ...(skipped.size ? { id: { notIn: [...skipped] } } : {}) },
      orderBy: { createdAt: "asc" },
      take: Math.min(100, limit - tried),
      select: { id: true },
    });
    if (!rows.length) break;
    tried += rows.length;
    let next = 0;
    let progress = 0;
    const worker = async () => {
      while (next < rows.length && Date.now() - started < SEND_BUDGET_MS) {
        const id = rows[next++].id;
        if (await deliverOne(id)) {
          sent++;
          progress++;
        } else skipped.add(id);
      }
    };
    await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));
    if (!progress) break; // everything left is locked by another run
  }
  return sent;
}

/** Sends one queued email. A row lock means two overlapping job runs can't send the same email twice. */
async function deliverOne(id: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ to: string; subject: string; body: string }[]>`
      SELECT "to", "subject", "body" FROM "EmailOutbox" WHERE "id" = ${id} AND "sentAt" IS NULL AND "error" IS NULL FOR UPDATE SKIP LOCKED`;
    if (!row) return false; // sent already, or another run is sending it
    try {
      await deliver(row.to, row.subject, row.body);
      await tx.emailOutbox.update({ where: { id }, data: { sentAt: new Date() } });
      return true;
    } catch (e) {
      await tx.emailOutbox.update({ where: { id }, data: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }, { timeout: 30_000 });
}

async function deliver(to: string, subject: string, _body: string) {
  const provider = process.env.EMAIL_PROVIDER ?? "log";
  if (provider === "log") {
    if (process.env.NODE_ENV === "development") console.info(`[email] to=${to} subject="${subject}" (stored in EmailOutbox)`);
    return;
  }
  throw new Error(`Email provider "${provider}" is not configured`);
}
