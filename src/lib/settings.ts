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
});
export type CompPlan = z.infer<typeof compPlanSchema>;

export const DEFAULT_COMP_PLAN: CompPlan = {
  directBonusPercent: 10,
  pairUnitPv: 100,
  pairingRatio: "1:1",
  pairValueMinor: 1000,
  dailyCapMinor: 50000,
  carryForward: true,
  maxCarryPv: 0,
  holdDays: 14,
  requireDirectOnEachLeg: true,
  minPersonalPv: 0,
  defaultPlacement: "WEAKER_LEG",
};

export const shopSettingsSchema = z.object({
  flatShippingMinor: z.number().int().min(0),
  freeShippingOverMinor: z.number().int().min(0),
  minPayoutMinor: z.number().int().min(0),
  orderExpiryMinutes: z.number().int().min(5),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;
export const DEFAULT_SHOP: ShopSettings = {
  flatShippingMinor: 500,
  freeShippingOverMinor: 10000,
  minPayoutMinor: 2000,
  orderExpiryMinutes: 60,
};

export async function getCompPlan(tx: Tx = prisma): Promise<CompPlan> {
  const row = await tx.setting.findUnique({ where: { key: "compPlan" } });
  return compPlanSchema.parse({ ...DEFAULT_COMP_PLAN, ...((row?.value as object) ?? {}) });
}

export async function getShopSettings(tx: Tx = prisma): Promise<ShopSettings> {
  const row = await tx.setting.findUnique({ where: { key: "shop" } });
  return shopSettingsSchema.parse({ ...DEFAULT_SHOP, ...((row?.value as object) ?? {}) });
}

export async function saveSetting(key: "compPlan" | "shop", value: CompPlan | ShopSettings, tx: Tx = prisma) {
  await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
