"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAffiliate, requireUser } from "@/lib/session";
import { becomeAffiliate } from "@/lib/users";
import { requestPayout } from "@/lib/wallet";
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

export async function payoutAction(input: { amount: string; method: "BANK_TRANSFER" | "MOBILE_MONEY"; destination: string }): Promise<ActionState> {
  const user = await requireAffiliate();
  return runAction(async () => {
    await requestPayout(user.id, { amountMinor: toMinor(input.amount), method: input.method, destination: input.destination });
    revalidatePath("/dashboard/payouts");
    return { ok: "Payout requested. We'll notify you when it's processed." };
  });
}
