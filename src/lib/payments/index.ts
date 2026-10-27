import "server-only";
import type { PaymentProvider } from "./types";
import { testProvider } from "./test-provider";
import { paystackProvider } from "./paystack";
import { testPaymentsAllowed } from "./keys";

const providers: Record<string, PaymentProvider> = { test: testProvider, paystack: paystackProvider };

export function getProvider(name = process.env.PAYMENT_PROVIDER ?? "test"): PaymentProvider {
  if (name === "test" && !testPaymentsAllowed()) {
    throw new Error("The simulated payment provider is disabled in production.");
  }
  const p = providers[name];
  if (!p) throw new Error(`Unknown payment provider: ${name}`);
  return p;
}
