import { PrismaClient } from "@prisma/client";

/**
 * Cost prices are omitted from every query unless a caller asks for them with `omit: { costPriceMinor: false }`.
 * Only code behind a PRODUCT_COSTS permission check does that (see canSeeCosts in session.ts).
 */
function makeClient() {
  return new PrismaClient({ omit: { product: { costPriceMinor: true }, productVariant: { costPriceMinor: true } } });
}

type Client = ReturnType<typeof makeClient>;
const g = globalThis as unknown as { prisma?: Client };
export const prisma = g.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export type Tx = Omit<Client, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
