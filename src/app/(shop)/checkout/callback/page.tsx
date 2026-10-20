import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getProvider } from "@/lib/payments";
import { applyPaymentEvent } from "@/lib/payments/service";
import { logError } from "@/lib/log";

/** Paystack sends the buyer back here. We verify server-side rather than trusting the redirect. */
export default async function PaymentCallback({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const sp = await searchParams;
  const ref = sp.reference ?? sp.trxref;
  const user = await requireUser("/orders");
  if (!ref) redirect("/orders");
  const payment = await prisma.payment.findUnique({ where: { providerRef: ref }, include: { order: true } });
  if (!payment || payment.order.userId !== user.id) redirect("/orders");
  const provider = getProvider(payment.provider);
  let state = "pending";
  try {
    const event = provider.verify ? await provider.verify(ref) : null;
    if (event) {
      const r = await applyPaymentEvent(provider.name, event, "callback");
      if (r.status === "paid" || r.status === "already_paid" || r.status === "duplicate") state = "1";
      else if (r.status === "failed" || r.status === "ignored_out_of_order") state = "failed";
    }
  } catch (e) {
    logError("payment verify", e);
  }
  redirect(`/orders/${payment.orderId}?paid=${state}`);
}
