import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { listSuccessfulTransactions } from "./paystack";

export type GatewayProblem = {
  reference: string;
  kind: "unknown_here" | "not_recorded_paid" | "amount_mismatch" | "not_paid_at_gateway";
  gatewayMinor: number | null;
  recordedMinor: number | null;
};

const PAID = ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;

/**
 * Compares Paystack's list of successful transactions with the payments recorded here, both ways, for a
 * period. Read-only apart from the audit record of the result. Anything found needs a person: the
 * payment runbook (docs/RUNBOOKS.md) says what to do with each kind.
 */
export async function reconcileGateway(from: Date, to: Date, opts: { fetchImpl?: typeof fetch; actorId?: string | null } = {}) {
  const txs = await listSuccessfulTransactions(from, to, opts.fetchImpl);
  const refs = txs.map((t) => t.reference);
  const [known, paidHere] = await Promise.all([
    prisma.payment.findMany({ where: { provider: "paystack", providerRef: { in: refs } } }),
    prisma.payment.findMany({ where: { provider: "paystack", status: { in: [...PAID] }, createdAt: { gte: from, lt: to } } }),
  ]);
  const byRef = new Map(known.map((p) => [p.providerRef, p]));
  const gatewayRefs = new Set(refs);
  const problems: GatewayProblem[] = [];
  for (const t of txs) {
    const p = byRef.get(t.reference);
    if (!p) problems.push({ reference: t.reference, kind: "unknown_here", gatewayMinor: t.amount, recordedMinor: null });
    else if (!(PAID as readonly string[]).includes(p.status)) problems.push({ reference: t.reference, kind: "not_recorded_paid", gatewayMinor: t.amount, recordedMinor: p.amountMinor });
    else if (p.amountMinor !== t.amount || p.currency !== t.currency) problems.push({ reference: t.reference, kind: "amount_mismatch", gatewayMinor: t.amount, recordedMinor: p.amountMinor });
  }
  for (const p of paidHere) {
    if (!gatewayRefs.has(p.providerRef)) problems.push({ reference: p.providerRef, kind: "not_paid_at_gateway", gatewayMinor: null, recordedMinor: p.amountMinor });
  }
  // Most serious first: money we think we have but Paystack doesn't, then wrong amounts, then the rest.
  const rank = { not_paid_at_gateway: 0, amount_mismatch: 1, not_recorded_paid: 2, unknown_here: 3 };
  problems.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const result = {
    from: from.toISOString(),
    to: to.toISOString(),
    gatewayCount: txs.length,
    gatewayMinor: txs.reduce((s, t) => s + t.amount, 0),
    recordedCount: paidHere.length,
    recordedMinor: paidHere.reduce((s, p) => s + p.amountMinor, 0),
    ok: problems.length === 0,
    problems: problems.slice(0, 100),
    problemCount: problems.length,
  };
  await audit("gateway.reconcile", "Payment", null, opts.actorId ?? null, result as unknown as Prisma.InputJsonObject);
  return result;
}
