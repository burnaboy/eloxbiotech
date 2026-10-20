export interface CheckoutRequest {
  orderId: string;
  orderNumber: string;
  /** Our payment reference, generated before the gateway is called. */
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
}

interface Base {
  /** Unique per gateway event; stored with a unique constraint so each is processed once. */
  eventId: string;
  /** Our payment reference (the transaction this event is about). */
  providerRef: string;
}

/** Gateway events, normalised. Amounts are in kobo. */
export type PaymentEvent =
  | (Base & { type: "payment.succeeded" | "payment.failed"; amountMinor: number; currency: string; reason?: string })
  | (Base & { type: "refund.processed"; amountMinor: number; refundId?: string })
  | (Base & { type: "refund.pending"; amountMinor: number; refundId?: string })
  | (Base & { type: "refund.failed"; amountMinor: number; refundId?: string; reason?: string })
  | (Base & { type: "dispute.opened"; amountMinor?: number })
  | (Base & { type: "dispute.resolved"; merchantLost: boolean; amountMinor?: number });

export interface RefundResult {
  refundId?: string;
  /** "processed" when the gateway confirms straight away (the simulator), otherwise wait for a webhook. */
  status: "pending" | "processed";
}

/** A gateway call that failed in a known way (the gateway said no), as opposed to a timeout or network error. */
export class GatewayError extends Error {
  constructor(message: string, readonly definite: boolean) {
    super(message);
  }
}

export interface PaymentProvider {
  name: string;
  /** Currencies the gateway accepts for this account. */
  currencies: string[];
  createCheckout(req: CheckoutRequest): Promise<{ redirectUrl: string }>;
  /** Verifies the webhook signature and returns a normalised event (null = ignore), or throws. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
  /** Asks the gateway for the current state of a payment (used by the callback page and reconciliation). */
  verify?(providerRef: string): Promise<PaymentEvent | null>;
  refund(providerRef: string, amountMinor: number, idempotencyKey: string): Promise<RefundResult>;
}
