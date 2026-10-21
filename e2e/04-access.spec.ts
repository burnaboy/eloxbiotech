import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { db, signIn } from "./helpers";

const ORIGIN = "http://localhost:3100";

/** Every server action defined in the admin actions file, from the production build's manifest. */
function adminActionIds() {
  const m = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { filename: string; exportedName: string; workers: Record<string, unknown> }>;
  };
  return Object.entries(m.node)
    .filter(([, v]) => v.filename === "app/admin/actions.ts")
    .map(([id, v]) => {
      // An action is served from the pages that use it; post to one without route parameters.
      const page = Object.keys(v.workers).find((w) => !w.includes("["))!;
      const path = page.replace(/^app/, "").replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "") || "/";
      return { id, name: v.exportedName, path };
    });
}

/** Counts of everything an admin action could change. */
async function snapshot() {
  const [audit, ledger, plans, payouts, products, categories, discounts, nodes, admins, sessions, settings, orders, users] = await Promise.all([
    db.auditLog.count(), db.ledgerEntry.count(), db.compPlanVersion.count(), db.payout.findMany({ select: { id: true, status: true } }),
    db.product.findMany({ select: { id: true, priceMinor: true, stock: true, status: true } }), db.category.count(), db.discountCode.count(),
    db.affiliateNode.count(), db.user.findMany({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } }, select: { id: true, adminPermissions: true } }),
    db.session.count(), db.setting.findMany({ select: { key: true, value: true } }), db.order.findMany({ select: { id: true, status: true } }),
    db.user.findMany({ select: { id: true, role: true, status: true, mfaEnabledAt: true } }),
  ]);
  return { audit, ledger, plans, payouts, products, categories, discounts, nodes, admins, sessions, settings, orders, users };
}

/** Posts each admin action the way a no-JavaScript form would, with plausible fields, and returns where each response sent the caller. */
async function callAll(request: APIRequestContext) {
  const out: { name: string; status: number; location: string }[] = [];
  for (const a of adminActionIds()) {
    const res = await request.post(a.path, {
      headers: { Origin: ORIGIN },
      multipart: {
        [`$ACTION_ID_${a.id}`]: "1", // an empty value is not recognised as an action call
        email: "ada@demo.local", amountMinor: "100000", amount: "1000", reason: "Trying to get in", confirm: "PLACE",
        status: "SUSPENDED", role: "SUPER_ADMIN", period: "2026-10-01", note: "x", directRate: "50",
      },
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    out.push({ name: a.name, status: res.status(), location: res.headers()["location"] ?? "" });
  }
  return out;
}

test("guests and ordinary members can't use admin pages, exports or admin actions", async ({ page, request }) => {
  const actions = adminActionIds();
  expect(actions.length).toBeGreaterThan(40);
  const before = await snapshot();

  // Signed out: every admin action sends the caller to sign in and changes nothing.
  for (const r of await callAll(request)) {
    expect(r.status, r.name).toBe(303);
    expect(r.location, r.name).toMatch(/^\/login/);
  }

  // A signed-in customer and a signed-in affiliate.
  for (const email of ["dami@demo.local", "ada@demo.local"]) {
    await page.context().clearCookies();
    await signIn(page, email, "Password123");
    for (const path of ["/admin", "/admin/orders", "/admin/users", "/admin/payouts", "/admin/settings", "/admin/audit", "/admin/team"]) {
      await page.goto(path);
      await expect(page, `${email} ${path}`).not.toHaveURL(/\/admin/);
    }
    for (const report of ["orders", "members", "ledger", "payouts", "audit"]) {
      const res = await page.request.get(`/admin/export/${report}`, { maxRedirects: 0, failOnStatusCode: false });
      expect(res.headers()["content-type"] ?? "", `${email} export ${report}`).not.toMatch(/csv/);
      expect(res.status(), `${email} export ${report}`).not.toBe(200);
    }
    for (const r of await callAll(page.request)) {
      expect(r.status, `${email} ${r.name}`).toBe(303);
      expect(r.location, `${email} ${r.name}`).not.toMatch(/\/admin|ok=/);
    }
  }

  // Sign-ins add sessions and their own audit records; nothing else may change.
  const after = await snapshot();
  const strip = (s: typeof before) => ({ ...s, audit: 0, sessions: 0 });
  expect(strip(after)).toEqual(strip(before));
  const newAudit = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: after.audit - before.audit });
  for (const a of newAudit) expect(a.action, "only sign-in records").toMatch(/^(auth|user)\.(login|signIn|session)/i);
});

test("members can't see other people's orders, and scheduled jobs and webhooks need their secrets", async ({ page, request }) => {
  const dami = await db.user.findUniqueOrThrow({ where: { email: "dami@demo.local" } });
  // An order belonging to another member.
  const ada = await db.user.findUniqueOrThrow({ where: { email: "ada@demo.local" } });
  const other = await db.order.create({
    data: {
      number: `E2E-${Date.now()}`, userId: ada.id, currency: "NGN", subtotalMinor: 100000, shippingMinor: 0, totalMinor: 100000, totalPv: 0,
      shipName: "Ada", shipPhone: "08030000001", shipLine1: "1 Marina", shipCity: "Lagos", shipState: "Lagos", shipCountry: "Nigeria",
      expiresAt: new Date(Date.now() + 3600e3),
    },
  });
  await signIn(page, "dami@demo.local", "Password123");
  for (const path of [`/orders/${other.id}`, `/orders/${other.id}/receipt`]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByText(other.number)).toHaveCount(0);
  }

  const cron = await request.post("/api/cron/mature-orders", { failOnStatusCode: false });
  expect(cron.status()).toBe(401);
  const wrong = await request.post("/api/cron/mature-orders", { headers: { Authorization: "Bearer wrong" }, failOnStatusCode: false });
  expect(wrong.status()).toBe(401);

  // Detailed health for the external monitor needs its own token and reveals no secrets.
  expect((await request.get("/api/health/status", { failOnStatusCode: false })).status()).toBe(401);
  expect((await request.get("/api/health/status", { headers: { Authorization: "Bearer e2e-cron" }, failOnStatusCode: false })).status()).toBe(401);
  const health = await request.get("/api/health/status", { headers: { Authorization: "Bearer e2e-monitor" }, failOnStatusCode: false });
  expect([200, 503]).toContain(health.status());
  const healthText = await health.text();
  expect(JSON.parse(healthText).checks.length).toBeGreaterThan(5);
  for (const secret of ["e2e-cron", "e2e-secret", "e2e-monitor", process.env.APP_ENCRYPTION_KEY!, "mlm:mlm"]) expect(healthText).not.toContain(secret);

  const forged = await request.post("/api/webhooks/test", {
    data: JSON.stringify({ eventId: "evt_forged", type: "payment.succeeded", providerRef: "x", amountMinor: 1, currency: "NGN" }),
    headers: { "content-type": "application/json", "x-test-signature": "0".repeat(64) },
    failOnStatusCode: false,
  });
  expect(forged.status()).toBe(401);
});
