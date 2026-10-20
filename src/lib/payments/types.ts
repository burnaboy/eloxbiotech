export interface CheckoutRequest {
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  email: string;
}

interface Base {
  eventId: string;
  providerRef: string;
}
export type PaymentEvent =
  | (Base & { type: "payment.succeeded" | "payment.failed"; amountMinor: number; currency: string })
  | (Base & { type: "payment.refunded"; amountMinor: number })
  | (Base & { type: "dispute.opened" })
  | (Base & { type: "dispute.resolved"; merchantLost: boolean });

export interface PaymentProvider {
  name: string;
  createCheckout(req: CheckoutRequest): Promise<{ providerRef: string; redirectUrl: string }>;
  /** Verifies the webhook signature and returns a normalised event (null = ignore), or throws. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
  /** Asks the gateway for the current state of a payment (used by the callback page and reconciliation). */
  verify?(providerRef: string): Promise<PaymentEvent | null>;
  refund(providerRef: string, amountMinor: number): Promise<void>;
}
