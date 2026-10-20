"use server";

import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/session";
import { addToCart, cancelPendingOrder, createOrderFromCart, setCartQuantity, type Address } from "@/lib/orders";
import { startPayment } from "@/lib/payments/service";
import { normaliseCode } from "@/lib/discounts";
import { DISCOUNT_COOKIE } from "@/lib/cart-code";
import { runAction, str, type ActionState } from "@/lib/action";
import { requestReturn } from "@/lib/returns";
import { z } from "zod";

const id = z.string().min(1).max(40);
const qty = z.number().int().min(0).max(99);

export async function addToCartAction(productId: string, quantity: number, returnTo: string, variantId: string | null = null): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/")}`);
  return runAction(async () => {
    await addToCart(user.id, id.parse(productId), qty.parse(quantity), variantId ? id.parse(variantId) : null);
    revalidatePath("/", "layout");
    return { ok: "Added to cart" };
  });
}

export async function setQuantityAction(productId: string, quantity: number, variantId: string | null = null): Promise<ActionState> {
  const user = await requireUser("/cart");
  return runAction(async () => {
    await setCartQuantity(user.id, id.parse(productId), qty.parse(quantity), variantId ? id.parse(variantId) : null);
    revalidatePath("/", "layout");
  });
}

/** The discount code lives in an httpOnly cookie; it is re-validated on the server every time the cart is priced. */
export async function applyDiscountAction(fd: FormData) {
  const user = await requireUser("/cart");
  const code = normaliseCode(str(fd, "code"));
  // Stops guessing codes by trying many in a row.
  const ip = await clientIp();
  const limited = await runAction(() => rateLimit("discountCode", user.id, ip));
  if (limited?.error) redirect(`/cart?error=${encodeURIComponent(limited.error)}`);
  const jar = await cookies();
  if (code) jar.set(DISCOUNT_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 });
  else jar.delete(DISCOUNT_COOKIE);
  revalidatePath("/cart");
  redirect("/cart");
}

export async function removeDiscountAction() {
  await requireUser("/cart");
  (await cookies()).delete(DISCOUNT_COOKIE);
  revalidatePath("/cart");
  redirect("/cart");
}

/**
 * `checkoutKey` is generated when the checkout page is shown. Submitting twice (double click, retry after a
 * network error) returns the same order instead of creating a second one.
 */
export async function checkoutAction(address: Address, checkoutKey: string): Promise<ActionState> {
  const user = await requireUser("/checkout");
  const limited = await runAction(() => rateLimit("checkout", user.id));
  if (limited) return limited;
  const jar = await cookies();
  let orderId = "";
  const res = await runAction(async () => {
    const order = await createOrderFromCart(user.id, address, { checkoutKey, discountCode: jar.get(DISCOUNT_COOKIE)?.value ?? null });
    orderId = order.id;
  });
  if (res) return res;
  jar.delete(DISCOUNT_COOKIE);
  let url = "";
  const pay = await runAction(async () => {
    url = await startPayment(orderId, user.id);
  });
  // The order is saved and its items are held; the buyer can retry payment from the order page.
  if (pay?.error) redirect(`/orders/${orderId}?error=${encodeURIComponent(pay.error)}`);
  redirect(url);
}

export async function payOrderAction(orderId: string) {
  const user = await requireUser("/orders");
  let url = "";
  const res = await runAction(async () => {
    url = await startPayment(orderId, user.id);
  });
  if (res?.error) redirect(`/orders/${orderId}?error=${encodeURIComponent(res.error)}`);
  redirect(url);
}

export async function cancelOrderAction(orderId: string) {
  const user = await requireUser("/orders");
  const res = await runAction(() => cancelPendingOrder(orderId, user.id, { userId: user.id }));
  revalidatePath(`/orders/${orderId}`);
  if (res?.error) redirect(`/orders/${orderId}?error=${encodeURIComponent(res.error)}`);
}

export async function requestReturnAction(orderId: string, fd: FormData) {
  const user = await requireUser("/orders");
  const res = await runAction(async () => {
    await requestReturn(user.id, orderId, str(fd, "reason"));
  });
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Return%20request%20sent.%20We%27ll%20reply%20shortly."}`);
}
