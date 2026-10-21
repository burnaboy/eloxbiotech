/**
 * The Paystack secret key, with the go-live rules enforced in code:
 * - outside production, and in staging (APP_ENV=staging), only test keys (sk_test_) are accepted;
 * - a live key (sk_live_) is refused until the business has approved live payments by setting
 *   LIVE_PAYMENTS_APPROVED=true in the production environment (docs/DEPLOYMENT.md, go-live).
 */
export function paystackSecretKey(env: NodeJS.ProcessEnv = process.env) {
  const k = env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not set");
  const live = k.startsWith("sk_live_");
  if (!live && !k.startsWith("sk_test_")) throw new Error("PAYSTACK_SECRET_KEY doesn't look like a Paystack secret key.");
  if (live && (env.NODE_ENV !== "production" || env.APP_ENV === "staging")) {
    throw new Error("Use a Paystack test key (sk_test_...) outside production.");
  }
  if (live && env.LIVE_PAYMENTS_APPROVED !== "true") {
    throw new Error("A live Paystack key is set, but live payments haven't been approved (LIVE_PAYMENTS_APPROVED).");
  }
  return k;
}
