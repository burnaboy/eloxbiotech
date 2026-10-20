"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/session";
import { addToCart, cancelPendingOrder, createOrderFromCart, setCartQuantity, startPayment, type Address } from "@/lib/orders";
import { runAction, str, type ActionState } from "@/lib/action";
import { requestReturn } from "@/lib/returns";

export async function addToCartAction(productId: string, quantity: number, returnTo: string): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return runAction(async () => {
    await addToCart(user.id, productId, quantity);
    revalidatePath("/", "layout");
    return { ok: "Added to cart" };
  });
}

export async function setQuantityAction(productId: string, quantity: number): Promise<ActionState> {
  const user = await requireUser("/cart");
  return runAction(async () => {
    await setCartQuantity(user.id, productId, quantity);
    revalidatePath("/", "layout");
  });
}

export async function checkoutAction(address: Address): Promise<ActionState> {
  const user = await requireUser("/checkout");
  let url = "";
  const res = await runAction(async () => {
    const order = await createOrderFromCart(user.id, address);
    url = await startPayment(order.id, user.id);
  });
  if (res) return res;
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
