import { expect, test } from "@playwright/test";

test("guest can browse the shop and read the policies", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shop by category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured products" })).toBeVisible();
  // No testimonials are published, so the section must not appear.
  await expect(page.getByRole("heading", { name: "What customers say" })).toHaveCount(0);

  await page.getByRole("link", { name: /Beverages/ }).first().click();
  await expect(page).toHaveURL(/\/category\/beverages/);
  await expect(page.getByText("Moringa Green Tea")).toBeVisible();

  await page.goto("/search?q=lotion");
  await expect(page.getByText(/1 product matching/)).toBeVisible();
  await page.getByRole("link", { name: /Shea Butter/ }).click();
  await expect(page.getByRole("heading", { name: /Shea Butter Body Lotion/ })).toBeVisible();
  await expect(page.getByText(/₦7,500\.00/)).toBeVisible();

  // Sorting, price filter and options.
  await page.goto("/products?sort=price-desc&min=10000");
  await expect(page.getByText(/^\d+ products?/)).toBeVisible();
  await expect(page.getByText("Moringa Green Tea")).toHaveCount(0); // cheaper than the minimum
  await page.goto("/products/sample-product-with-sizes");
  await expect(page.getByText("From")).toBeVisible();
  await page.getByText("500 g").click();
  await expect(page.getByText("₦10,000.00").last()).toBeVisible();

  for (const path of ["/about", "/contact", "/faq", "/affiliate-programme", "/compensation", "/legal/terms", "/legal/privacy", "/legal/shipping", "/legal/refunds", "/legal/earnings-disclaimer"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
  }
});

test("protected pages send guests to sign in", async ({ page }) => {
  for (const path of ["/cart", "/checkout", "/dashboard", "/admin", "/account"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login\?next=/);
  }
});

test("pages fit the screen without sideways scrolling, for guests and signed-in members", async ({ page }) => {
  const fits = async (path: string) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // On a phone, content that is too wide makes the browser zoom out, so compare with the device width.
    const width = page.viewportSize()!.width;
    const scroll = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
    expect(scroll, `${path} is ${scroll}px wide on a ${width}px screen`).toBeLessThanOrEqual(width);
  };
  for (const path of ["/", "/products", "/products/sample-product-with-sizes", "/compensation", "/login", "/register"]) await fits(path);
  const { signIn } = await import("./helpers");
  await signIn(page, "ada@demo.local", "Password123");
  for (const path of ["/dashboard", "/dashboard/tree", "/dashboard/commissions", "/dashboard/payouts", "/account", "/cart", "/orders"]) await fits(path);
});
