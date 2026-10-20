import { z } from "zod";
import { toMinor } from "./money";

/** Shared by the admin product form (browser) and the server action. The server always re-validates. */
const amount = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 12500 or 12500.50");
const optAmount = amount.or(z.literal(""));
const optInt = (max: number) => z.string().trim().regex(/^\d*$/, "Whole numbers only").refine((s) => s === "" || Number(s) <= max, `At most ${max}`);
const optCm = z.string().trim().regex(/^(\d{1,4}(\.\d)?)?$/, "Centimetres, up to one decimal");
const dateTime = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "Invalid date");

export const productFormSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and dashes").max(120),
    sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{2,40}$/, "2–40 letters, numbers, dots, dashes"),
    description: z.string().trim().min(10, "At least 10 characters").max(5000),
    categoryId: z.string().max(40),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    featured: z.boolean(),
    price: amount,
    salePrice: optAmount,
    saleStartsAt: dateTime,
    saleEndsAt: dateTime,
    costPrice: optAmount.optional(),
    pv: z.string().trim().regex(/^\d{1,7}$/, "Whole number"),
    lowStockThreshold: z.string().trim().regex(/^\d{1,6}$/, "Whole number"),
    shippable: z.boolean(),
    weightGrams: optInt(1_000_000),
    lengthCm: optCm,
    widthCm: optCm,
    heightCm: optCm,
    metaTitle: z.string().trim().max(70, "Keep it under 70 characters"),
    metaDescription: z.string().trim().max(160, "Keep it under 160 characters"),
    attributes: z.string().max(4000),
    initialStock: optInt(1_000_000).optional(),
  })
  .superRefine((v, ctx) => {
    const ok = (s: string) => /^\d{1,12}(\.\d{1,2})?$/.test(s);
    if (v.salePrice && ok(v.salePrice) && ok(v.price) && toMinor(v.salePrice) >= toMinor(v.price)) ctx.addIssue({ code: "custom", path: ["salePrice"], message: "Sale price must be below the regular price" });
    if (v.saleStartsAt && v.saleEndsAt && v.saleStartsAt >= v.saleEndsAt) ctx.addIssue({ code: "custom", path: ["saleEndsAt"], message: "End must be after start" });
    if ((v.saleStartsAt || v.saleEndsAt) && !v.salePrice) ctx.addIssue({ code: "custom", path: ["salePrice"], message: "Set a sale price for the sale dates" });
  });

export type ProductFormValues = z.input<typeof productFormSchema>;

export const variantFormSchema = z.object({
  name: z.string().trim().min(1, "Name the option").max(80),
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{2,40}$/, "2–40 letters, numbers, dots, dashes"),
  options: z.string().max(500),
  price: optAmount,
  salePrice: optAmount,
  costPrice: optAmount.optional(),
  pv: optInt(1_000_000),
  weightGrams: optInt(1_000_000),
  lowStockThreshold: optInt(100_000),
  sortOrder: z.string().trim().regex(/^-?\d{0,4}$/),
  active: z.boolean(),
  initialStock: optInt(1_000_000).optional(),
});

/** "12.5" cm -> 125 mm, integer maths on the string. */
export function cmToMm(s: string) {
  if (!s) return null;
  const [w, f = "0"] = s.split(".");
  return Number(w) * 10 + Number(f.slice(0, 1));
}

export function mmToCm(mm: number | null) {
  if (mm === null || mm === undefined) return "";
  return mm % 10 === 0 ? String(mm / 10) : `${Math.trunc(mm / 10)}.${mm % 10}`;
}

/** Lagos is UTC+1 all year. Converts a datetime-local value entered in Lagos time to a Date. */
export function lagosLocalToDate(s: string) {
  return s ? new Date(`${s}:00+01:00`) : null;
}

export function dateToLagosLocal(d: Date | null) {
  if (!d) return "";
  return new Date(d.getTime() + 3600e3).toISOString().slice(0, 16);
}
