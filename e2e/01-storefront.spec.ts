import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

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

test("the home page slideshow shows the products and can be paused and stepped through", async ({ page }) => {
  await page.goto("/");
  const show = page.getByRole("region", { name: "Elox products" });
  await expect(show.getByText("Alkaline water, bottled for every day")).toBeVisible();
  await show.getByRole("button", { name: "Pause slideshow" }).click();
  await expect(show.getByRole("button", { name: "Play slideshow" })).toBeVisible();
  await show.getByRole("button", { name: "Next slide" }).click();
  await expect(show.getByText("Hydration that keeps up with you")).toBeVisible();
  await show.getByRole("button", { name: /^Show slide 3:/ }).click();
  await expect(show.getByText("HB Solution water disinfectant")).toBeVisible();
  await expect(show.getByText("Alkaline water, bottled for every day")).toBeHidden();
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
  await signIn(page, "ada@demo.local", "Password123");
  for (const path of ["/dashboard", "/dashboard/tree", "/dashboard/commissions", "/dashboard/payouts", "/account", "/cart", "/orders"]) await fits(path);
});

test("the colour mode switch steps through system, light and dark, and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // System (default) follows the device, which is dark here.
  await expect(html).not.toHaveAttribute("data-theme");
  expect(await bg()).toBe("rgb(14, 17, 16)");

  await page.getByRole("button", { name: /Colour mode: System/ }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await bg()).toBe("rgb(250, 250, 247)");

  await page.getByRole("button", { name: /Colour mode: Light/ }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  // The server renders the saved choice on the next page, so there is no flash of the wrong colours.
  expect(await (await page.request.get("/products")).text()).toContain('data-theme="dark"');
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/products");
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await bg()).toBe("rgb(14, 17, 16)");

  await page.getByRole("button", { name: /Colour mode: Dark/ }).click();
  await expect(html).not.toHaveAttribute("data-theme");
  expect(await bg()).toBe("rgb(250, 250, 247)");
});
