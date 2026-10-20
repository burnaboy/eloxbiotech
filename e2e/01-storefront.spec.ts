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
