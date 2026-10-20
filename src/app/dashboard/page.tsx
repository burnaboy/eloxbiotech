import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getCompPlan } from "@/lib/settings";
import { walletBalance } from "@/lib/wallet";
import { isQualified } from "@/lib/commissions";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Stat } from "@/components/stat";
import { CopyField } from "@/components/copy-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Empty } from "@/components/ui/table";
import { setDefaultLegAction } from "./actions";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  if (user.role === "CUSTOMER") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hello, {user.name.split(" ")[0]}</CardTitle>
          <CardDescription>You have a customer account. Become an affiliate to share products and earn commissions on completed sales.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild><Link href="/dashboard/join">Become an affiliate</Link></Button>
          <Button asChild variant="outline"><Link href="/orders">My orders</Link></Button>
        </CardContent>
      </Card>
    );
  }
  const [node, brand, plan, wallet, recent] = await Promise.all([
    prisma.affiliateNode.findUniqueOrThrow({ where: { userId: user.id } }),
    getBrand(),
    getCompPlan(),
    walletBalance(user.id),
    prisma.commission.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const qualified = await isQualified(prisma, node, plan);
  const [sponsor, parent] = await Promise.all([
    user.sponsorId ? prisma.user.findUnique({ where: { id: user.sponsorId }, select: { name: true, referralCode: true } }) : null,
    node.parentId ? prisma.affiliateNode.findUnique({ where: { id: node.parentId }, include: { user: { select: { name: true } } } }) : null,
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const base = process.env.APP_URL ?? "";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
        {qualified ? <Badge tone="success">Qualified for binary</Badge> : <Badge tone="warning">Not yet qualified for binary</Badge>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Available balance" value={m(wallet.availableMinor)} hint={`${m(wallet.earnedMinor)} earned in total`} />
        <Stat label="Left leg volume" value={`${node.leftCarryPv.toLocaleString()} PV`} hint={`${node.leftTotalPv.toLocaleString()} PV all time · ${node.leftCount} members`} />
        <Stat label="Right leg volume" value={`${node.rightCarryPv.toLocaleString()} PV`} hint={`${node.rightTotalPv.toLocaleString()} PV all time · ${node.rightCount} members`} />
        <Stat label="Personal volume" value={`${node.personalPv.toLocaleString()} PV`} hint="From your own and your customers' purchases" />
      </div>
      <Card className="flex flex-wrap gap-x-8 gap-y-2 p-5 text-sm">
        <p><span className="text-muted-foreground">Sponsor:</span> {sponsor ? `${sponsor.name} (${sponsor.referralCode})` : "Company"}</p>
        <p><span className="text-muted-foreground">Placed under:</span> {parent ? parent.user.name : "Top of network"}</p>
        <p><span className="text-muted-foreground">Side:</span> {node.position?.toLowerCase() ?? "—"}</p>
        <p><span className="text-muted-foreground">Level:</span> {node.depth}</p>
        <p><span className="text-muted-foreground">Pending commissions:</span> {m(wallet.pendingMinor)}</p>
      </Card>
      {!qualified && (
        <Card className="p-5 text-sm">
          To earn binary commissions you need
          {plan.requireDirectOnEachLeg && " at least one active affiliate you personally referred on each side"}
          {plan.requireDirectOnEachLeg && plan.minPersonalPv > 0 && " and"}
          {plan.minPersonalPv > 0 && ` ${plan.minPersonalPv} personal PV`}.
          Volume keeps building in the meantime. <Link href="/compensation" className="text-primary underline">See the plan</Link>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your referral links</CardTitle>
            <CardDescription>Code <strong>{user.referralCode}</strong>. Anyone who joins through these links is placed in your tree.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyField label="Automatic placement" value={`${base}/r/${user.referralCode}`} />
            <CopyField label="Place on my left" value={`${base}/r/${user.referralCode}?leg=LEFT`} />
            <CopyField label="Place on my right" value={`${base}/r/${user.referralCode}?leg=RIGHT`} />
            <form action={setDefaultLegAction} className="flex items-end gap-2 pt-2">
              <div className="flex-1 space-y-1">
                <label htmlFor="leg" className="text-xs font-medium text-muted-foreground">Default side for automatic links</label>
                <Select id="leg" name="leg" defaultValue={node.defaultLeg ?? ""}>
                  <option value="">Weaker side (plan default)</option>
                  <option value="LEFT">Always left</option>
                  <option value="RIGHT">Always right</option>
                </Select>
              </div>
              <Button variant="outline">Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent commissions</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/dashboard/commissions">View all</Link></Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? <Empty>No commissions yet. Share a product link to get started.</Empty> : (
              <ul className="divide-y text-sm">
                {recent.map((c) => (
                  <li key={c.id} className="flex justify-between py-2">
                    <span><Badge tone={c.amountMinor < 0 ? "danger" : "primary"}>{c.type.toLowerCase()}</Badge> <span className="ml-2 text-muted-foreground">{formatDate(c.createdAt)}</span></span>
                    <span className={`tabular-nums ${c.amountMinor < 0 ? "text-destructive" : ""}`}>{m(c.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
