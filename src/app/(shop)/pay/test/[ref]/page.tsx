import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { buildTestEvent, testProvider } from "@/lib/payments/test-provider";
import { applyPaymentEvent } from "@/lib/payments/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Test payment" };

function guard() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PAYMENTS !== "true") notFound();
}

async function simulate(ref: string, outcome: "succeeded" | "failed") {
  "use server";
  guard();
  const user = await requireUser();
  const p = await prisma.payment.findUnique({ where: { providerRef: ref }, include: { order: true } });
  if (!p || p.order.userId !== user.id || p.provider !== "test") notFound();
  // Goes through the same signature check as a real webhook.
  const { body, signature } = buildTestEvent({ type: `payment.${outcome}`, providerRef: ref, amountMinor: p.amountMinor, currency: p.currency });
  const event = await testProvider.parseWebhook(body, new Headers({ "x-test-signature": signature }));
  if (event) await applyPaymentEvent("test", event, "webhook", JSON.parse(body));
  redirect(`/orders/${p.orderId}?paid=${outcome === "succeeded" ? "1" : ""}${outcome === "failed" ? "&error=Payment%20was%20declined" : ""}`);
}

export default async function TestPayPage({ params }: { params: Promise<{ ref: string }> }) {
  guard();
  const { ref } = await params;
  const user = await requireUser();
  const p = await prisma.payment.findUnique({ where: { providerRef: ref }, include: { order: true } });
  if (!p || p.order.userId !== user.id || p.provider !== "test") notFound();
  return (
    <div className="container flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-warning" aria-hidden /> Test payment</CardTitle>
          <CardDescription>Simulated gateway for development. No money moves.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>Order <strong>{p.order.number}</strong> · {formatMoney(p.amountMinor, p.currency)}</p>
          <div className="flex gap-3">
            <form action={simulate.bind(null, ref, "succeeded")}><Button>Pay successfully</Button></form>
            <form action={simulate.bind(null, ref, "failed")}><Button variant="outline">Decline</Button></form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
