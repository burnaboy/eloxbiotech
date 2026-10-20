"use server";

import { rateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAffiliate, requireUser } from "@/lib/session";
import { becomeAffiliate } from "@/lib/users";
import { cancelPayout, requestPayout } from "@/lib/wallet";
import { removePayoutAccount, savePayoutAccount } from "@/lib/payouts/accounts";
import { runAction, type ActionState } from "@/lib/action";
import { prisma } from "@/lib/db";
import { toMinor } from "@/lib/money";

export async function joinAction(leg: "LEFT" | "RIGHT" | null): Promise<ActionState> {
  const user = await requireUser("/dashboard/join");
  const res = await runAction(async () => {
    await becomeAffiliate(user.id, leg);
  });
  if (res) return res;
  redirect("/dashboard");
}

export async function setDefaultLegAction(fd: FormData) {
  const user = await requireAffiliate();
  const leg = z.enum(["", "LEFT", "RIGHT"]).parse(fd.get("leg") ?? "");
  await prisma.affiliateNode.update({ where: { userId: user.id }, data: { defaultLeg: leg || null } });
  revalidatePath("/dashboard");
}

export async function payoutAction(amount: string, requestKey: string): Promise<ActionState> {
  const user = await requireAffiliate();
  return runAction(async () => {
    await rateLimit("payoutRequest", user.id);
    await requestPayout(user.id, { amountMinor: toMinor(amount) }, requestKey);
    revalidatePath("/dashboard/payouts");
    return { ok: "Withdrawal requested. We'll email you as it moves along." };
  });
}

export async function saveAccountAction(input: { bankCode: string; accountNumber: string }): Promise<ActionState> {
  const user = await requireAffiliate();
  return runAction(async () => {
    await rateLimit("payoutAccount", user.id);
    const a = await savePayoutAccount(user.id, input);
    revalidatePath("/dashboard/payouts");
    return { ok: a.verifiedAt ? `Saved: ${a.accountName}. Check that this is your name.` : "Saved. Our team will confirm the account before your first withdrawal." };
  });
}

export async function removeAccountAction() {
  const user = await requireAffiliate();
  const res = await runAction(() => removePayoutAccount(user.id));
  revalidatePath("/dashboard/payouts");
  redirect(`/dashboard/payouts?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Bank%20account%20removed"}`);
}

export async function cancelPayoutAction(id: string) {
  const user = await requireAffiliate();
  const res = await runAction(() => cancelPayout(user.id, id));
  revalidatePath("/dashboard/payouts");
  redirect(`/dashboard/payouts?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Withdrawal%20cancelled.%20The%20amount%20is%20back%20in%20your%20wallet."}`);
}
