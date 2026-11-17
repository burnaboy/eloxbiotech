import "./server-only-shim";
import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { decrypt } from "../src/lib/crypto";
import { codeAt, currentStep } from "../src/lib/totp";

export const db = new PrismaClient();

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

/** Reads the newest email to `to` from the outbox and returns the first link in it. */
export async function latestLink(to: string, pathPart: string) {
  const mail = await db.emailOutbox.findFirstOrThrow({ where: { to, body: { contains: pathPart } }, orderBy: { createdAt: "desc" } });
  const m = mail.body.match(/https?:\/\/\S+/);
  expect(m).not.toBeNull();
  return new URL(m![0]).pathname;
}

/**
 * A TOTP code the server will accept: the server refuses a time step it has already seen,
 * so this waits for the next 30-second window when needed.
 */
export async function totpFor(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const secret = decrypt(u.mfaSecretEnc!);
  let step = currentStep();
  if (u.mfaLastStep !== null && step <= u.mfaLastStep) step = u.mfaLastStep + 1;
  while (step > currentStep() + 1) await new Promise((r) => setTimeout(r, 1000));
  return codeAt(secret, step);
}
