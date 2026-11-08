import { PrismaClient } from "@prisma/client";

/**
 * Cost prices are omitted from every query unless a caller asks for them with `omit: { costPriceMinor: false }`.
 * Only code behind a PRODUCT_COSTS permission check does that (see canSeeCosts in session.ts).
 */
function makeClient() {
  return new PrismaClient({ datasourceUrl: databaseUrl(), omit: { product: { costPriceMinor: true }, productVariant: { costPriceMinor: true } } });
}

/**
 * Connection pool per app instance. Prisma's default is 2 × CPUs + 1, which is only 3 connections on a
 * 1-CPU server, so a few slow requests make every other request queue. DB_POOL_SIZE (and DB_POOL_TIMEOUT,
 * seconds) set it without editing the database URL. Keep instances × pool size under the database's
 * connection limit (docs/SCALING.md). Values already in DATABASE_URL win.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env) {
  const raw = env.DATABASE_URL;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const size = Number(env.DB_POOL_SIZE);
  if (Number.isInteger(size) && size > 0 && !url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", String(size));
  const timeout = Number(env.DB_POOL_TIMEOUT);
  if (Number.isInteger(timeout) && timeout > 0 && !url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", String(timeout));
  return url.toString();
}

type Client = ReturnType<typeof makeClient>;
const g = globalThis as unknown as { prisma?: Client };
export const prisma = g.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export type Tx = Omit<Client, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
