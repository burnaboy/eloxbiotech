import { z } from "zod";
import { prisma, type Tx } from "./db";

/**
 * Compensation plan. Every number here is a placeholder until the business confirms
 * the plan; admins can change them in Admin > Settings without a deploy.
 */
export const compPlanSchema = z.object({
  /** Direct (referral) bonus as a percent of the order subtotal, paid to the buyer's sponsor. */
  directBonusPercent: z.number().min(0).max(100),
  /** PV needed on a leg to make one pairing unit. */
  pairUnitPv: z.number().int().positive(),
  /** "1:1" pairs one left unit with one right unit. "2:1" pairs 2 units on either side with 1 on the other. */
  pairingRatio: z.enum(["1:1", "2:1"]),
  /** Amount paid per pair, in minor units. */
  pairValueMinor: z.number().int().min(0),
  /** Most a single affiliate can earn from binary per period. 0 = no cap. */
  dailyCapMinor: z.number().int().min(0),
  /** If false, any leftover leg volume is cleared after each run. */
  carryForward: z.boolean(),
  /** Upper limit on carried PV per leg. 0 = unlimited. */
  maxCarryPv: z.number().int().min(0),
  /** Days after payment before an order earns commissions and volume (refund window). */
  holdDays: z.number().int().min(0).max(90),
  /** Affiliate must personally sponsor at least one active affiliate on each leg to earn binary. */
  requireDirectOnEachLeg: z.boolean(),
  /** Personal PV in the affiliate's own purchases needed to be "active". 0 = no requirement. */
  minPersonalPv: z.number().int().min(0),
  /** How new members are placed when the referral link doesn't name a leg. */
  defaultPlacement: z.enum(["WEAKER_LEG", "LEFT", "RIGHT"]),
  /** AUTO places new affiliates immediately; ADMIN_APPROVAL queues them for an administrator to place. */
  placementMode: z.enum(["AUTO", "ADMIN_APPROVAL"]),
});
export type CompPlan = z.infer<typeof compPlanSchema>;

export const DEFAULT_COMP_PLAN: CompPlan = {
  directBonusPercent: 10,
  pairUnitPv: 100,
  pairingRatio: "1:1",
  pairValueMinor: 200000,
  dailyCapMinor: 10000000,
  carryForward: true,
  maxCarryPv: 0,
  holdDays: 14,
  requireDirectOnEachLeg: true,
  minPersonalPv: 0,
  defaultPlacement: "WEAKER_LEG",
  placementMode: "AUTO",
};

export const shopSettingsSchema = z.object({
  flatShippingMinor: z.number().int().min(0),
  freeShippingOverMinor: z.number().int().min(0),
  minPayoutMinor: z.number().int().min(0),
  orderExpiryMinutes: z.number().int().min(5),
  returnWindowDays: z.number().int().min(0).max(90),
  deliveryInfo: z.string().trim().max(500),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;
export const DEFAULT_SHOP: ShopSettings = {
  flatShippingMinor: 250000,
  freeShippingOverMinor: 5000000,
  minPayoutMinor: 500000,
  orderExpiryMinutes: 60,
  returnWindowDays: 7,
  deliveryInfo: "Delivery in 2–5 working days within Lagos and 3–7 working days elsewhere in Nigeria.",
};

/** Emergency switches, only changeable by a super administrator. */
export const opsSchema = z.object({
  checkoutPaused: z.boolean(),
  payoutsPaused: z.boolean(),
  commissionsPaused: z.boolean(),
  notice: z.string().trim().max(300),
});
export type Ops = z.infer<typeof opsSchema>;
export const DEFAULT_OPS: Ops = { checkoutPaused: false, payoutsPaused: false, commissionsPaused: false, notice: "" };

export async function getOps(tx: Tx = prisma): Promise<Ops> {
  const row = await tx.setting.findUnique({ where: { key: "ops" } });
  return opsSchema.parse({ ...DEFAULT_OPS, ...((row?.value as object) ?? {}) });
}

export const brandSchema = z.object({
  companyName: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160),
  logoUrl: z.string().trim().url().or(z.literal("")),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  currency: z.enum(["NGN", "GHS", "ZAR", "KES", "USD"]),
  supportEmail: z.string().trim().email().or(z.literal("")),
  supportPhone: z.string().trim().max(30),
  address: z.string().trim().max(300),
  registrationNumber: z.string().trim().max(60),
  about: z.string().trim().max(3000),
});
export type Brand = z.infer<typeof brandSchema>;
export const DEFAULT_BRAND: Brand = {
  companyName: "Binary Commerce",
  tagline: "Genuine products, rewarded fairly.",
  logoUrl: "",
  primaryColor: "#0f5132",
  accentColor: "#c9a227",
  currency: "NGN",
  supportEmail: "",
  supportPhone: "",
  address: "",
  registrationNumber: "",
  about: "",
};

export async function getBrand(tx: Tx = prisma): Promise<Brand> {
  const row = await tx.setting.findUnique({ where: { key: "brand" } });
  return brandSchema.parse({ ...DEFAULT_BRAND, ...((row?.value as object) ?? {}) });
}

export async function getCompPlan(tx: Tx = prisma): Promise<CompPlan> {
  const row = await tx.setting.findUnique({ where: { key: "compPlan" } });
  return compPlanSchema.parse({ ...DEFAULT_COMP_PLAN, ...((row?.value as object) ?? {}) });
}

export async function getShopSettings(tx: Tx = prisma): Promise<ShopSettings> {
  const row = await tx.setting.findUnique({ where: { key: "shop" } });
  return shopSettingsSchema.parse({ ...DEFAULT_SHOP, ...((row?.value as object) ?? {}) });
}

export async function saveSetting(key: "compPlan" | "shop" | "brand" | "ops", value: CompPlan | ShopSettings | Brand | Ops, tx: Tx = prisma) {
  await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
