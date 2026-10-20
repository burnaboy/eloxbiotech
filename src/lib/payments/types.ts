export interface CheckoutRequest {
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  email: string;
}

export interface PaymentEvent {
  eventId: string;
  type: "payment.succeeded" | "payment.failed";
  providerRef: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentProvider {
  name: string;
  createCheckout(req: CheckoutRequest): Promise<{ providerRef: string; redirectUrl: string }>;
  /** Verifies the webhook signature and returns a normalised event, or throws. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
  refund(providerRef: string, amountMinor: number): Promise<void>;
}
