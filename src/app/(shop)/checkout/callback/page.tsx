import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getProvider } from "@/lib/payments";
import { applyPaymentEvent } from "@/lib/orders";

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
      const r = await applyPaymentEvent(provider.name, event);
      if (r.status === "paid" || r.status === "duplicate") state = "1";
    }
  } catch (e) {
    console.error("payment verify failed", e);
  }
  redirect(`/orders/${payment.orderId}?paid=${state}`);
}
