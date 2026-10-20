import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Commissions" };

function describe(c: { type: string; details: unknown; note: string | null; order: { number: string } | null }) {
  const d = (c.details ?? {}) as Record<string, number | string>;
  if (c.type === "DIRECT") return `${d.percent}% of order ${c.order?.number ?? ""}`;
  if (c.type === "BINARY") return `${d.pairs} pair(s) for ${d.periodKey}${Number(d.flushedMinor) > 0 ? " (daily cap reached)" : ""}`;
  return c.note ?? "Adjustment";
}

export default async function CommissionsPage() {
  const user = await requireAffiliate();
  const [rows, brand] = await Promise.all([
    prisma.commission.findMany({ where: { userId: user.id }, include: { order: { select: { number: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    getBrand(),
  ]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Commissions</h1>
      {rows.length === 0 ? <Empty>No commissions yet.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Type</Th><Th>Details</Th><Th className="text-right">Amount</Th></tr></THead>
          <TBody>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.createdAt)}</Td>
                <Td><Badge tone={c.amountMinor < 0 ? "danger" : "primary"}>{c.type.toLowerCase()}</Badge></Td>
                <Td className="text-muted-foreground">{describe(c)}</Td>
                <Td className={`text-right tabular-nums ${c.amountMinor < 0 ? "text-destructive" : ""}`}>{formatMoney(c.amountMinor, brand.currency)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
