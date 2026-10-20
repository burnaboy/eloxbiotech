"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { clientIp, endSession, startSession } from "@/lib/session";
import { registerUser, type RegisterInput } from "@/lib/users";
import { runAction, type ActionState } from "@/lib/action";

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200), next: z.string().optional() });

export async function loginAction(input: z.input<typeof loginSchema>): Promise<ActionState> {
  let dest = "/";
  const res = await runAction(async () => {
    const v = loginSchema.parse(input);
    const user = await authenticate(v.email, v.password, await clientIp());
    await startSession(user.id);
    dest = safeNext(v.next);
  });
  if (res) return res;
  redirect(dest);
}

export async function registerAction(input: RegisterInput): Promise<ActionState> {
  const res = await runAction(async () => {
    const user = await registerUser(input);
    await startSession(user.id);
    (await cookies()).delete("ref");
  });
  if (res) return res;
  redirect(input.joinAsAffiliate ? "/dashboard" : "/");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}
