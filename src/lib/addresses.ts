import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";

export const addressInput = z.object({
  label: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(5).max(30),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100),
  postal: z.string().trim().max(20).optional().or(z.literal("")),
  isDefault: z.boolean().default(false),
});

export async function saveAddress(userId: string, id: string | null, raw: z.input<typeof addressInput>) {
  const v = addressInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id && !(await tx.address.findFirst({ where: { id, userId } }))) throw new AppError("Address not found.");
    const count = await tx.address.count({ where: { userId } });
    if (!id && count >= 10) throw new AppError("You can save up to 10 addresses.");
    const isDefault = v.isDefault || count === 0;
    if (isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    const data = { ...v, line2: v.line2 || null, postal: v.postal || null, isDefault };
    return id ? tx.address.update({ where: { id }, data }) : tx.address.create({ data: { ...data, userId } });
  });
}

export async function deleteAddress(userId: string, id: string) {
  await prisma.address.deleteMany({ where: { id, userId } });
}
