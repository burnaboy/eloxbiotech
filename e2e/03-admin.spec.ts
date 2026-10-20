import { expect, test } from "@playwright/test";
import { db, signIn, totpFor } from "./helpers";

const ADMIN = "admin@binarycommerce.local";

test("super admin must set up two-step verification, then can ship an order and needs a fresh code to refund", async ({ page }) => {
  await signIn(page, ADMIN, "AdminPass123");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/account\/security\?required=1/);
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  await page.getByLabel("Code from the app").fill(await totpFor(ADMIN));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Save these recovery codes")).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Revenue and commissions, last 30 days")).toBeVisible();

  const order = await db.order.findFirstOrThrow({ where: { status: "PAID" } });
  await page.goto(`/admin/orders/${order.id}`);
  await page.getByLabel("Carrier").fill("GIG Logistics");
  await page.getByLabel("Tracking reference").fill("GIG123");
  await page.getByRole("button", { name: "Mark shipped" }).click();
  await expect(page.getByText("Marked as shipped")).toBeVisible();

  // Refund is a sensitive action: it asks for a fresh code first.
  await page.getByLabel("Reason").fill("Customer changed mind");
  await page.getByLabel("Confirmation").fill("REFUND");
  await page.getByRole("button", { name: "Refund order" }).click();
  await expect(page).toHaveURL(/\/admin\/verify/);
  await page.getByLabel("Authentication code").fill(await totpFor(ADMIN));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${order.id}`));
  await page.getByLabel("Reason").fill("Customer changed mind");
  await page.getByLabel("Confirmation").fill("REFUND");
  await page.getByRole("button", { name: "Refund order" }).click();
  await expect(page.getByText("Order refunded")).toBeVisible();

  const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(after.status).toBe("REFUNDED");
  const c = await db.commission.findFirstOrThrow({ where: { orderId: order.id } });
  expect(c.status).toBe("REVERSED");

  // The ledger check finds nothing wrong after a refund.
  await page.goto("/admin/risk");
  await page.getByRole("button", { name: "Run check now" }).click();
  await expect(page.getByText(/match the ledger/)).toBeVisible();

  // A member waiting for approval gets placed from the queue (the code above is still fresh).
  const ada = await db.user.findUniqueOrThrow({ where: { email: "ada@demo.local" } });
  const pending = await db.user.create({
    data: { email: "pending@demo.local", name: "Pending Demo", passwordHash: "x", referralCode: "PENDING1", role: "AFFILIATE", sponsorId: ada.id, placementPending: true, requestedLeg: "RIGHT", emailVerifiedAt: new Date() },
  });
  await page.goto("/admin/network");
  await expect(page.getByText("Waiting for placement")).toBeVisible();
  await page.getByRole("button", { name: "Place" }).click();
  await expect(page.getByText("Member placed")).toBeVisible();
  const rec = await db.placementRecord.findFirstOrThrow({ where: { userId: pending.id } });
  expect(rec.method).toBe("ADMIN");
  expect(rec.position).toBe("RIGHT");
  await expect(page.getByRole("cell", { name: "Pending Demo" })).toBeVisible();

  // Every admin page renders.
  for (const p of ["orders", "returns", "products", "categories", "testimonials", "users", "network", "commissions", "payouts", "support", "risk", "settings", "audit", "team", "operations"]) {
    const res = await page.goto(`/admin/${p}`);
    expect(res?.status(), p).toBe(200);
  }
});

test.setTimeout(120_000);

test("a second sign-in for an MFA account asks for the code", async ({ page }) => {
  await signIn(page, ADMIN, "AdminPass123");
  await expect(page).toHaveURL(/\/login\/verify/);
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code isn't valid")).toBeVisible();
  await page.getByLabel("Authentication code").fill(await totpFor(ADMIN));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).not.toHaveURL(/\/login/);
});
