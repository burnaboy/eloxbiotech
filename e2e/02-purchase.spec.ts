import { expect, test } from "@playwright/test";
import { db, latestLink } from "./helpers";

test("referred customer registers, verifies email, buys with a test payment, and the sponsor gets a pending commission", async ({ page }) => {
  const ada = await db.user.findUniqueOrThrow({ where: { email: "ada@demo.local" } });
  const email = `buyer-${Date.now()}@example.com`;

  await page.goto(`/r/${ada.referralCode}`);
  await page.goto("/register");
  await expect(page.getByText("You were invited by")).toBeVisible();
  await page.getByLabel("Full name").fill("Test Buyer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("buyerpass123");
  await page.getByLabel("Confirm password").fill("buyerpass123");
  await page.getByText("I agree to the terms").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByText("Please confirm your email address")).toBeVisible();

  // Checkout is blocked until the email is confirmed.
  await page.goto(`/products/${(await db.product.findUniqueOrThrow({ where: { sku: "SAMPLE-001" } })).slug}`);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/account\?error=/);

  await page.goto(await latestLink(email, "/verify-email/"));
  await expect(page.getByText("your email is confirmed")).toBeVisible();

  // An option product goes in the cart with its own price.
  await page.goto("/products/sample-product-with-sizes");
  await page.getByText("500 g").click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();

  await page.goto("/cart");
  await expect(page.getByText("500 g")).toBeVisible();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.getByLabel("Phone").fill("08030000000");
  await page.getByLabel("Address", { exact: true }).fill("12 Admiralty Way");
  await page.getByLabel("City").fill("Lekki");
  await page.getByLabel("State").fill("Lagos");
  await page.getByRole("button", { name: /Continue to secure payment/ }).click();

  await expect(page.getByRole("heading", { name: /Test payment/ })).toBeVisible();
  await page.getByRole("button", { name: "Pay successfully" }).click();
  await expect(page.getByText("Payment received")).toBeVisible();
  await page.getByRole("link", { name: "Receipt" }).click();
  await expect(page.getByText("RECEIPT")).toBeVisible();

  const buyer = await db.user.findUniqueOrThrow({ where: { email } });
  const order = await db.order.findFirstOrThrow({ where: { userId: buyer.id } });
  expect(order.status).toBe("PAID");
  const c = await db.commission.findFirstOrThrow({ where: { orderId: order.id, userId: ada.id } });
  expect(c.status).toBe("PENDING");
  expect(c.amountMinor).toBe(225000); // 10% of ₦12,500 + ₦10,000 (placeholder plan)
  const large = await db.productVariant.findUniqueOrThrow({ where: { sku: "SAMPLE-009-L" } });
  expect(large.stock).toBe(9);
});

test("an affiliate sees referral links, the tree and the pending commission", async ({ page }) => {
  const { signIn } = await import("./helpers");
  await signIn(page, "ada@demo.local", "Password123");
  await page.goto("/dashboard");
  await expect(page.getByText("Your referral links")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Currently qualifying/ })).toBeVisible();
  await page.getByRole("link", { name: "Binary tree" }).click();
  await expect(page.getByText("Bayo Demo")).toBeVisible();
  await expect(page.getByText("Chi Demo")).toBeVisible();
  await page.getByLabel("Search members").fill("chi");
  await page.getByRole("button", { name: "Search" }).click();
  // The search is a plain form, so the page reloads; let it finish loading before clicking a result.
  await page.waitForLoadState("networkidle");
  await page.getByRole("list", { name: "Search results" }).getByRole("link", { name: /Chi Demo/ }).click();
  await expect(page.getByRole("link", { name: "Back to me" })).toBeVisible();
  // Searching never reveals people outside your own downline.
  await page.goto("/dashboard/tree?q=Company");
  await expect(page.getByText("No members match")).toBeVisible();
  await page.goto("/dashboard/commissions?status=PENDING");
  await expect(page.getByRole("cell", { name: "pending" }).first()).toBeVisible();
  // Affiliates must not reach the admin area.
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
});
