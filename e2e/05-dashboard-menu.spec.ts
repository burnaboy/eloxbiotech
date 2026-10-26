import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("every item in the affiliate side menu opens a working page", async ({ page }) => {
  await signIn(page, "ada@demo.local", "Password123");
  const menu = [
    ["Buy product", /\/products$/],
    ["Purchase history", /\/orders$/],
    ["My E-wallets", /\/dashboard\/wallets$/],
    ["Pairing history", /\/dashboard\/pairing$/],
    ["Rank awards", /\/dashboard\/rank-awards$/],
    ["All withdrawals", /\/dashboard\/payouts$/],
    ["Package upgrade", /\/dashboard\/package-upgrade$/],
    ["Need support", /\/support$/],
    ["Stockist location", /\/dashboard\/stockists$/],
  ] as const;
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Section" });
  await expect(nav.getByRole("link", { name: "My referrals" })).toBeVisible();
  const labels = await nav.getByRole("link").allInnerTexts();
  expect(labels.slice(labels.indexOf("My referrals") + 1, labels.indexOf("My referrals") + 1 + menu.length)).toEqual(menu.map(([l]) => l));
  for (const [label, url] of menu) {
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Section" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  await page.goto("/dashboard/rank-awards");
  await expect(page.getByText("Your rank")).toBeVisible();
  await expect(page.getByText("Next rank:")).toBeVisible();

  await page.goto("/dashboard/stockists");
  await expect(page.getByText("Demo Stockist Ikeja")).toBeVisible();
  await page.getByRole("link", { name: "FCT" }).click();
  await expect(page.getByText("Demo Stockist Wuse")).toBeVisible();
  await expect(page.getByText("Demo Stockist Ikeja")).toBeHidden();
});

test("a member buys a package through checkout and it becomes their current package", async ({ page }) => {
  await signIn(page, "ada@demo.local", "Password123");
  await page.goto("/dashboard/package-upgrade");
  await expect(page.getByText("None yet")).toBeVisible();
  await page.getByRole("link", { name: "Choose" }).first().click();
  await expect(page.getByRole("heading", { name: "Starter Package" })).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  await page.goto("/cart");
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.getByLabel("Phone").fill("08030000000");
  await page.getByLabel("Address", { exact: true }).fill("12 Admiralty Way");
  await page.getByLabel("City").fill("Lekki");
  await page.getByLabel("State").fill("Lagos");
  await page.getByRole("button", { name: /Continue to secure payment/ }).click();
  await page.getByRole("button", { name: "Pay successfully" }).click();
  await expect(page.getByText("Payment received")).toBeVisible();

  await page.goto("/dashboard/package-upgrade");
  await expect(page.getByText("current", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Upgrade", exact: true })).toHaveCount(2);
});
