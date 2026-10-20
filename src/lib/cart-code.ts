import { cookies } from "next/headers";

export const DISCOUNT_COOKIE = "cart_code";

/** The discount code the shopper entered, if any. Only a hint: getCart validates it on every request. */
export async function cartCode() {
  return (await cookies()).get(DISCOUNT_COOKIE)?.value ?? null;
}
