import "server-only";
import { randomBytes } from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { notify } from "../notify";
import { queueEmail } from "../email";
import { formatMoney } from "../money";
import { getBrand } from "../settings";
import { currentPlanVersion } from "../comp-plan";
import { onOrderPaid, holdOrderCommissions, releaseOrderCommissions } from "../commissions";
import { EVER_PAID, LIVE_PAID, transitionOrder } from "../order-state";
import { recordRefund } from "../refunds";
import { getProvider } from "./index";
import { GatewayError, type PaymentEvent } from "./types";
import { logError } from "../log";

/*
 * Payments. The rules:
 *  - The amount to pay always comes from the order in our database, never from the browser.
 *  - An order is marked paid only by a verified gateway event (a signed webhook, or a server-side verify
 *    call), and only if the amount, currency and reference all match what we expect.
 *  - The browser coming back from the gateway proves nothing; the callback page verifies with the gateway.
 *  - Every event is stored once (unique provider + event id). Replays are recognised and do nothing.
 *  - Events can arrive in any order. A successful payment is never turned back into pending or failed.
 *  - All changes for one order happen under a row lock on that order, one event at a time.
 */

const REUSE_MINUTES = 20;
const MAX_ATTEMPTS = 10;

function newReference(orderNumber: string) {
  return `ELX-${orderNumber}-${randomBytes(5).toString("hex")}`;
}

/** Starts (or resumes) payment for an order and returns the URL to send the buyer to. */
export async function startPayment(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { user: true } });
  if (!order) throw new AppError("Order not found.", 404);
  if (order.status !== "PENDING_PAYMENT") throw new AppError("This order is not awaiting payment.");
  if (order.expiresAt < new Date()) throw new AppError("This order has expired. Please check out again.");
  if (!Number.isSafeInteger(order.totalMinor) || order.totalMinor <= 0) throw new AppError("This order has nothing to pay.");
  const provider = getProvider();
  if (!provider.currencies.includes(order.currency)) throw new AppError(`Payments in ${order.currency} aren't supported. Please contact support.`);

  // A buyer coming back to pay might already have paid on an earlier attempt: check before charging again.
  if (provider.verify) {
    const open = await prisma.payment.findMany({ where: { orderId, provider: provider.name, status: "PENDING", authorizationUrl: { not: null } }, orderBy: { createdAt: "desc" }, take: 3 });
    for (const p of open) {
      const e = await provider.verify(p.providerRef).catch(() => null);
      if (e?.type === "payment.succeeded") {
        const r = await applyPaymentEvent(provider.name, e, "callback");
        if (r.status === "paid" || r.status === "already_paid" || r.status === "duplicate") return `/orders/${orderId}?paid=1`;
      }
    }
  }

  const payment = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pay:${orderId}`}))`;
    const recent = await tx.payment.findFirst({
      where: { orderId, provider: provider.name, status: "PENDING", amountMinor: order.totalMinor, currency: order.currency, authorizationUrl: { not: null }, createdAt: { gt: new Date(Date.now() - REUSE_MINUTES * 60e3) } },
      orderBy: { createdAt: "desc" },
    });
    if (recent) return recent;
    const attempts = await tx.payment.count({ where: { orderId } });
    if (attempts >= MAX_ATTEMPTS) throw new AppError("Too many payment attempts on this order. Please contact support.");
    // The Payment row (with our unique reference) exists before the gateway hears about it, so any
    // webhook for it can be matched even if this request dies half-way.
    return tx.payment.create({ data: { orderId, provider: provider.name, providerRef: newReference(order.number), amountMinor: order.totalMinor, currency: order.currency } });
  });
  if (payment.authorizationUrl) return payment.authorizationUrl;

  try {
    const { redirectUrl } = await provider.createCheckout({ orderId, orderNumber: order.number, reference: payment.providerRef, amountMinor: payment.amountMinor, currency: payment.currency, email: order.user.email });
    await prisma.payment.update({ where: { id: payment.id }, data: { authorizationUrl: redirectUrl } });
    return redirectUrl;
  } catch (e) {
    const definite = e instanceof GatewayError && e.definite;
    // Refused: this attempt is dead. Unknown (timeout): leave it pending; reconciliation will check it.
    await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: definite ? { status: "FAILED", failureReason: (e as Error).message.slice(0, 300) } : { failureReason: "Gateway didn't answer in time" } });
    logError("payment start", e);
    throw new AppError(definite ? "The payment provider couldn't start this payment. Please try again, or contact support if it keeps happening." : "We couldn't reach the payment provider. Please try again in a minute.", 502);
  }
}

export type EventResult =
  | "duplicate" | "unknown_payment" | "paid" | "already_paid" | "amount_mismatch" | "late_payment" | "extra_payment"
  | "failed" | "ignored_out_of_order" | "refund_confirmed" | "refund_recorded" | "refund_pending" | "refund_failed" | "ignored"
  | "disputed" | "dispute_won" | "charged_back";

async function alertStaff(tx: Tx, title: string, body: string, link: string) {
  const staff = await tx.user.findMany({ where: { status: "ACTIVE", OR: [{ role: "SUPER_ADMIN" }, { role: "ADMIN", adminPermissions: { hasSome: ["ORDERS", "RISK"] } }] }, select: { id: true } });
  for (const s of staff) await notify(s.id, title, body, link, tx);
}

async function sendConfirmation(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, user: true } });
  if (order.confirmationSentAt) return;
  const brand = await getBrand(tx);
  const lines = order.items.map((i) => `${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ""}: ${formatMoney(i.paidMinor, order.currency)}`);
  const body = [
    `Thank you for your order ${order.number}. We've received your payment of ${formatMoney(order.totalMinor, order.currency)}.`,
    "",
    ...lines,
    order.discountMinor ? `Discount: −${formatMoney(order.discountMinor, order.currency)}` : "",
    `Delivery: ${formatMoney(order.shippingMinor, order.currency)}`,
    order.taxMinor ? `VAT ${order.taxIncluded ? "included" : "added"}: ${formatMoney(order.taxMinor, order.currency)}` : "",
    `Total paid: ${formatMoney(order.totalMinor, order.currency)}`,
    "",
    `Delivering to ${order.shipName}, ${order.shipLine1}, ${order.shipCity}, ${order.shipState}.`,
    `Receipt: ${process.env.APP_URL ?? ""}/orders/${order.id}/receipt`,
  ].filter((l) => l !== "");
  await queueEmail(order.user.email, `${brand.companyName}: order ${order.number} confirmed`, lines.length ? body.join("\n") : body[0], tx);
  await tx.order.update({ where: { id: orderId }, data: { confirmationSentAt: new Date() } });
}

async function handleSucceeded(tx: Tx, payment: Payment, event: Extract<PaymentEvent, { type: "payment.succeeded" | "payment.failed" }>): Promise<EventResult> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
  if (event.amountMinor !== payment.amountMinor || event.currency !== payment.currency || payment.amountMinor !== order.totalMinor || payment.currency !== order.currency) {
    if (payment.status === "PENDING" || payment.status === "FAILED") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: `Amount or currency mismatch: received ${event.amountMinor} ${event.currency}, expected ${order.totalMinor} ${order.currency}` } });
    }
    await audit("payment.amountMismatch", "Order", order.id, null, { providerRef: payment.providerRef, received: { amountMinor: event.amountMinor, currency: event.currency }, expected: { amountMinor: order.totalMinor, currency: order.currency } }, tx);
    await alertStaff(tx, "Payment amount mismatch", `A payment for order ${order.number} doesn't match the order total. It was not accepted. Check it in the payment gateway and refund it if money was taken.`, `/admin/orders/${order.id}`);
    return "amount_mismatch";
  }
  if (payment.status !== "PENDING" && payment.status !== "FAILED") return "already_paid";
  const moved = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "SUCCEEDED", verifiedAt: new Date(), failureReason: null } });
  if (moved.count === 0) return "already_paid";

  if (order.status === "PENDING_PAYMENT") {
    const version = await currentPlanVersion(tx);
    const paidAt = new Date();
    await transitionOrder(tx, order.id, "PAID", { paidAt, paidPaymentId: payment.id, planVersionId: version.id }, ["PENDING_PAYMENT"]);
    await onOrderPaid(tx, { ...order, paidAt, planVersionId: version.id });
    await notify(order.userId, "Payment received", `We've received payment for order ${order.number}.`, `/orders/${order.id}`, tx, "order");
    await sendConfirmation(tx, order.id);
    await audit("order.paid", "Order", order.id, null, { providerRef: payment.providerRef, amountMinor: payment.amountMinor, planVersion: version.version }, tx);
    return "paid";
  }
  // Money arrived but the order can't take it: cancelled/expired before payment, or already paid by another attempt.
  const late = order.status === "CANCELLED";
  await audit(late ? "payment.late" : "payment.extra", "Payment", payment.id, null, { orderId: order.id, orderStatus: order.status, amountMinor: payment.amountMinor }, tx);
  await alertStaff(
    tx,
    late ? "Payment received for a cancelled order" : "Extra payment received",
    `Order ${order.number} ${late ? "was cancelled before this payment arrived" : "was already paid"}. Give the ${formatMoney(payment.amountMinor, payment.currency)} back from the order page.`,
    `/admin/orders/${order.id}`,
  );
  await notify(order.userId, "We received an extra payment", `We received ${formatMoney(payment.amountMinor, payment.currency)} for order ${order.number}, which ${late ? "had already been cancelled" : "was already paid"}. We'll refund it.`, `/orders/${order.id}`, tx, "order");
  return late ? "late_payment" : "extra_payment";
}

/** Finds the refund a gateway refund event is about: by gateway id, else the oldest unconfirmed one of that amount. */
async function matchRefund(tx: Tx, paymentId: string, refundId: string | undefined, amountMinor: number) {
  if (refundId) {
    const byId = await tx.refund.findUnique({ where: { providerRefundId: refundId } });
    if (byId) return byId;
  }
  return tx.refund.findFirst({ where: { paymentId, status: { in: ["PENDING", "FAILED"] }, amountMinor, ...(refundId ? { providerRefundId: null } : {}) }, orderBy: { createdAt: "asc" } });
}

/**
 * Applies one verified gateway event. Idempotent and safe under concurrency.
 * `source` says where the event came from (webhook, callback, reconcile); `payload` is stored for audit.
 */
export async function applyPaymentEvent(providerName: string, event: PaymentEvent, source = "webhook", payload?: unknown): Promise<{ status: EventResult; orderId?: string }> {
  return prisma.$transaction(async (tx) => {
    const stored = await tx.webhookEvent.createMany({
      data: [{ provider: providerName, eventId: event.eventId, type: event.type, source, providerRef: event.providerRef, payload: (payload ?? event) as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    if (stored.count === 0) return { status: "duplicate" as const };
    const done = async (status: EventResult, orderId?: string) => {
      await tx.webhookEvent.update({ where: { provider_eventId: { provider: providerName, eventId: event.eventId } }, data: { result: status } });
      return { status, orderId };
    };

    const found = await tx.payment.findUnique({ where: { providerRef: event.providerRef } });
    if (!found || found.provider !== providerName) return done("unknown_payment");
    // One event at a time per order.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.orderId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });

    switch (event.type) {
      case "payment.succeeded":
        return done(await handleSucceeded(tx, payment, event), order.id);

      case "payment.failed": {
        // Only an open attempt can fail. A success that was already recorded is never undone by a late failure.
        const moved = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason: event.reason?.slice(0, 300) ?? "Declined" } });
        return done(moved.count ? "failed" : "ignored_out_of_order", order.id);
      }

      case "refund.pending":
      case "refund.processed":
      case "refund.failed": {
        const refund = await matchRefund(tx, payment.id, event.refundId, event.amountMinor);
        if (event.type === "refund.pending") {
          if (refund && !refund.providerRefundId && event.refundId) await tx.refund.update({ where: { id: refund.id }, data: { providerRefundId: event.refundId } });
          return done("refund_pending", order.id);
        }
        if (event.type === "refund.failed") {
          if (!refund || refund.status === "PROCESSED") return done("ignored", order.id);
          await tx.refund.update({ where: { id: refund.id }, data: { status: "FAILED", failureReason: event.reason?.slice(0, 300) ?? "Refused by the payment provider", providerRefundId: refund.providerRefundId ?? event.refundId ?? null } });
          await alertStaff(tx, "Refund failed", `A refund of ${formatMoney(refund.amountMinor, order.currency)} on order ${order.number} failed at the payment provider. Retry it from the order page.`, `/admin/orders/${order.id}`);
          return done("refund_failed", order.id);
        }
        if (refund) {
          if (refund.status !== "PROCESSED") {
            await tx.refund.update({ where: { id: refund.id }, data: { status: "PROCESSED", processedAt: new Date(), failureReason: null, providerRefundId: refund.providerRefundId ?? event.refundId ?? null } });
          }
          return done("refund_confirmed", order.id);
        }
        // A refund we didn't start (made in the gateway dashboard). Record it so our books match.
        if (event.amountMinor <= 0) return done("ignored", order.id);
        if (order.paidPaymentId === payment.id && LIVE_PAID.includes(order.status)) {
          await recordRefund(tx, order.id, { amountMinor: Math.min(event.amountMinor, order.totalMinor - order.refundedMinor) }, { reason: "Refunded in payment gateway", actorId: null, source: "gateway", status: "PROCESSED", providerRefundId: event.refundId ?? null, paymentId: payment.id });
          return done("refund_recorded", order.id);
        }
        if (payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED") {
          const amount = Math.min(event.amountMinor, payment.amountMinor - payment.refundedMinor);
          if (amount > 0 && order.paidPaymentId !== payment.id) {
            const total = payment.refundedMinor + amount;
            await tx.payment.update({ where: { id: payment.id }, data: { refundedMinor: total, status: total === payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
            await tx.refund.create({ data: { orderId: order.id, paymentId: payment.id, amountMinor: amount, status: "PROCESSED", processedAt: new Date(), providerRefundId: event.refundId ?? null, reason: "Extra payment refunded in payment gateway", source: "gateway", lines: { lines: [], shippingMinor: 0 } } });
            return done("refund_recorded", order.id);
          }
        }
        // Nothing left to refund on our side (e.g. a second notice for a refund already recorded).
        return done("ignored", order.id);
      }

      case "dispute.opened": {
        if (!EVER_PAID.includes(order.status) || order.paidPaymentId !== payment.id) return done("ignored", order.id);
        if (!order.disputedAt) await tx.order.update({ where: { id: order.id }, data: { disputedAt: new Date() } });
        await holdOrderCommissions(tx, order.id);
        await audit("order.disputeOpened", "Order", order.id, null, { providerRef: payment.providerRef }, tx);
        await alertStaff(tx, "Payment dispute opened", `The customer disputed the payment for order ${order.number}. Commissions on it are on hold. Don't ship it until the dispute is resolved.`, `/admin/orders/${order.id}`);
        return done("disputed", order.id);
      }

      case "dispute.resolved": {
        if (order.paidPaymentId !== payment.id) return done("ignored", order.id);
        await tx.order.update({ where: { id: order.id }, data: { disputedAt: null } });
        if (event.merchantLost) {
          const left = order.totalMinor - order.refundedMinor;
          const amount = Math.min(event.amountMinor && event.amountMinor > 0 ? event.amountMinor : left, left);
          if (amount > 0 && LIVE_PAID.includes(order.status)) {
            // Reverses the charged-back share straight from HELD, then releases whatever is left.
            await recordRefund(tx, order.id, { amountMinor: amount }, { reason: "Chargeback", actorId: null, source: "chargeback", status: "PROCESSED", paymentId: payment.id });
          }
          await releaseOrderCommissions(tx, order.id);
          await audit("order.chargeback", "Order", order.id, null, { amountMinor: amount }, tx);
          return done("charged_back", order.id);
        }
        await releaseOrderCommissions(tx, order.id);
        await audit("order.disputeWon", "Order", order.id, null, undefined, tx);
        return done("dispute_won", order.id);
      }
    }
  });
}

/**
 * Re-checks open payment attempts with the gateway, in case a webhook was missed or delayed.
 * Run on a schedule. Attempts the gateway has never heard of are closed after a day.
 */
export async function reconcilePendingPayments(olderThanMinutes = 5) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60e3);
  const pending = await prisma.payment.findMany({ where: { status: "PENDING", createdAt: { lt: cutoff, gt: new Date(Date.now() - 30 * 864e5) } }, orderBy: { createdAt: "asc" }, take: 200 });
  const results: Record<string, number> = {};
  const count = (k: string) => (results[k] = (results[k] ?? 0) + 1);
  for (const p of pending) {
    const provider = getProvider(p.provider);
    if (!provider.verify) continue;
    try {
      const e = await provider.verify(p.providerRef);
      if (!e) {
        count("still_pending");
        continue;
      }
      const r = await applyPaymentEvent(provider.name, e, "reconcile");
      count(r.status);
    } catch (e) {
      if (e instanceof GatewayError && e.definite && p.createdAt < new Date(Date.now() - 864e5)) {
        await prisma.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "Never completed at the payment provider" } });
        count("closed");
      } else {
        count("error");
      }
    }
  }
  return results;
}

/** Problems for the risk page: payments needing staff action. */
export async function paymentIssues() {
  const [extra, mismatched, failedRefunds, unconfirmedRefunds] = await Promise.all([
    prisma.$queryRaw<{ id: string; orderId: string; number: string; amountMinor: number; currency: string; status: string }[]>`
      SELECT p.id, p."orderId", o.number, p."amountMinor", p.currency, o.status::text AS status FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
      WHERE p.status = 'SUCCEEDED' AND (o."paidPaymentId" IS NULL OR o."paidPaymentId" <> p.id) ORDER BY p."createdAt" DESC LIMIT 50`,
    prisma.payment.findMany({ where: { failureReason: { startsWith: "Amount or currency mismatch" } }, include: { order: { select: { number: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.refund.findMany({ where: { status: "FAILED" }, include: { order: { select: { number: true, currency: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.refund.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 864e5) } }, include: { order: { select: { number: true, currency: true } } }, orderBy: { createdAt: "asc" }, take: 50 }),
  ]);
  return { extra, mismatched, failedRefunds, unconfirmedRefunds };
}
