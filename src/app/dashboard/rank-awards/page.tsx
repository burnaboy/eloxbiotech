import Link from "next/link";
import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { RANKS, rankProgress } from "@/lib/ranks";
import { Stat } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { PendingPlacement } from "@/components/pending-placement";

export const metadata = { title: "Rank awards" };

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground"><span>{label}</span><span>{pct}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function RankAwardsPage() {
  const user = await requireAffiliate();
  const [node, directs] = await Promise.all([
    prisma.affiliateNode.findUnique({ where: { userId: user.id } }),
    prisma.user.count({ where: { sponsorId: user.id, role: "AFFILIATE", status: "ACTIVE" } }),
  ]);
  if (!node) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Rank awards</h1>
        <PendingPlacement requestedLeg={user.requestedLeg} />
      </>
    );
  }
  const lesserLegPv = Math.min(node.leftTotalPv, node.rightTotalPv);
  const p = rankProgress({ directs, lesserLegPv });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Rank awards</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Your rank" value={p.current.name} hint={`Award: ${p.current.award}`} />
        <Stat label="Active affiliates you referred" value={directs.toLocaleString()} hint={p.next ? `${p.next.name} needs ${p.next.directs}` : "Top rank reached"} />
        <Stat label="Weaker team volume" value={`${lesserLegPv.toLocaleString()} PV`} hint={`Left ${node.leftTotalPv.toLocaleString()} PV, right ${node.rightTotalPv.toLocaleString()} PV, all time`} />
      </div>
      {p.next ? (
        <Card>
          <CardHeader>
            <CardTitle>Next rank: {p.next.name}</CardTitle>
            <CardDescription>Reach both targets to earn the {p.next.award.toLowerCase()} award.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Bar pct={p.directsPct} label={`${directs} of ${p.next.directs} active affiliates referred`} />
            <Bar pct={p.pvPct} label={`${lesserLegPv.toLocaleString()} of ${p.next.lesserLegPv.toLocaleString()} PV on your weaker team`} />
          </CardContent>
        </Card>
      ) : (
        <Card className="p-5 text-sm">You have reached the highest rank. Congratulations!</Card>
      )}
      <h2 className="text-lg font-semibold">All ranks</h2>
      <Table>
        <THead><tr><Th>Rank</Th><Th className="text-right">Active affiliates referred</Th><Th className="text-right">Weaker team PV</Th><Th>Award</Th><Th>Status</Th></tr></THead>
        <TBody>
          {RANKS.map((r) => {
            const done = p.achieved.includes(r);
            return (
              <tr key={r.name} aria-current={r === p.current ? "true" : undefined} className={r === p.current ? "bg-primary/5" : ""}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="text-right tabular-nums">{r.directs}</Td>
                <Td className="text-right tabular-nums">{r.lesserLegPv.toLocaleString()}</Td>
                <Td>{r.award}</Td>
                <Td>{r === p.current ? <Badge tone="primary">current</Badge> : done ? <Badge tone="success">achieved</Badge> : <Badge>not yet</Badge>}</Td>
              </tr>
            );
          })}
        </TBody>
      </Table>
      <p className="text-xs text-muted-foreground">Awards are presented by Elox staff once a rank is reached. Ranks do not change your commissions. Questions? <Link href="/support/new" className="text-primary underline">Contact support</Link>.</p>
    </>
  );
}
