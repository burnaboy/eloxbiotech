import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Pairing history" };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export default async function PairingPage() {
  const user = await requireAffiliate();
  const [rows, brand] = await Promise.all([
    prisma.commission.findMany({ where: { userId: user.id, type: "BINARY" }, orderBy: { createdAt: "desc" }, take: 200 }),
    getBrand(),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const list = rows.map((c) => {
    const d = (c.details ?? {}) as Record<string, unknown>;
    return {
      c,
      period: String(d.periodKey ?? ""),
      pairs: num(d.pairs),
      leftPv: num(d.leftUsedPv),
      rightPv: num(d.rightUsedPv),
      flushed: num(d.flushedMinor),
      leftCarry: num(d.leftCarryPv),
      rightCarry: num(d.rightCarryPv),
    };
  });
  const totalPairs = list.reduce((s, r) => s + r.pairs, 0);
  const totalPaid = list.reduce((s, r) => s + r.c.amountMinor - r.c.reversedMinor, 0);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Pairing history</h1>
      <p className="text-sm text-muted-foreground">Each binary run matches volume from your left and right teams into pairs. Unmatched volume carries forward to the next run.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total pairs" value={totalPairs.toLocaleString()} hint={`Across ${list.length} run${list.length === 1 ? "" : "s"}`} />
        <Stat label="Pairing bonus earned" value={m(totalPaid)} hint="After any reversals" />
        <Stat label="Carried forward" value={list[0] ? `${list[0].leftCarry.toLocaleString()} / ${list[0].rightCarry.toLocaleString()} PV` : "—"} hint="Left / right after the latest run" />
      </div>
      {list.length === 0 ? <Empty>No pairings yet. Pairs are matched when both your left and right teams have volume.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Period</Th><Th className="text-right">Pairs</Th><Th className="text-right">Left PV used</Th><Th className="text-right">Right PV used</Th><Th>Status</Th><Th className="text-right">Bonus</Th></tr></THead>
          <TBody>
            {list.map((r) => (
              <tr key={r.c.id}>
                <Td>{formatDate(r.c.createdAt)}</Td>
                <Td>{r.period}</Td>
                <Td className="text-right tabular-nums">{r.pairs.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{r.leftPv.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{r.rightPv.toLocaleString()}</Td>
                <Td><StatusBadge status={r.c.status} /></Td>
                <Td className="text-right tabular-nums">
                  {m(r.c.amountMinor - r.c.reversedMinor)}
                  {r.flushed > 0 && <span className="block text-xs text-muted-foreground">{m(r.flushed)} over the daily cap</span>}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
