import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-states";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getCompPlan } from "@/lib/settings";
import { memberOverview } from "@/lib/member-overview";
import { isQualified } from "@/lib/commissions";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Stat } from "@/components/stat";
import { CopyField } from "@/components/copy-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Empty } from "@/components/ui/table";
import { setDefaultLegAction } from "./actions";
import { volumeSummary } from "@/lib/volume";
import { VolumeTable } from "@/components/volume-table";
import { PendingPlacement } from "@/components/pending-placement";

const placementLabel = { AUTO: "automatic", SPONSOR_CHOICE: "side chosen by sponsor", ADMIN: "assigned by an administrator" } as const;

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
  // The figures stream in behind a skeleton, so the page responds at once even when the queries are slow.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AffiliateOverview user={user} />
    </Suspense>
  );
}

async function AffiliateOverview({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const [node, brand, plan, overview, recent] = await Promise.all([
    prisma.affiliateNode.findUnique({ where: { userId: user.id } }),
    getBrand(),
    getCompPlan(),
    memberOverview(user.id),
    prisma.commission.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const { wallet, sales } = overview;
  if (!node) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
        <PendingPlacement requestedLeg={user.requestedLeg} />
      </>
    );
  }
  const qualified = await isQualified(prisma, node, plan);
  const [sponsor, parent, volume, placement] = await Promise.all([
    user.sponsorId ? prisma.user.findUnique({ where: { id: user.sponsorId }, select: { name: true, referralCode: true } }) : null,
    node.parentId ? prisma.affiliateNode.findUnique({ where: { id: node.parentId }, include: { user: { select: { name: true } } } }) : null,
    volumeSummary(node),
    prisma.placementRecord.findUnique({ where: { nodeId: node.id } }),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const base = process.env.APP_URL ?? "";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
        {qualified ? <Badge tone="success">Qualified for binary</Badge> : <Badge tone="warning">Not yet qualified for binary</Badge>}
      </div>
      <section aria-labelledby="money-heading" className="space-y-3">
        <h2 id="money-heading" className="text-sm font-medium text-muted-foreground">Sales and earnings</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Verified affiliate sales" value={m(sales.netMinor)} hint={`${sales.orders} paid order${sales.orders === 1 ? "" : "s"}, after ${m(sales.refundedMinor)} refunded. Only payments confirmed with the payment provider count.`} />
          <Stat label="Pending commissions" value={m(wallet.pendingMinor)} hint="Waiting for the refund window to end" />
          <Stat label="Available balance" value={m(wallet.availableMinor)} hint={<Link href="/dashboard/payouts" className="text-primary underline">Withdraw</Link>} />
          <Stat label="Held or reversed" value={m(wallet.heldMinor + wallet.reversedMinor)} hint={`${m(wallet.heldMinor)} held for review, ${m(wallet.reversedMinor)} reversed after refunds`} />
          <Stat label="Withdrawal in progress" value={m(wallet.reservedMinor)} hint="Set aside for a withdrawal being processed" />
          <Stat label="Paid withdrawals" value={m(wallet.paidOutMinor)} hint="Confirmed as sent to your bank" />
        </div>
      </section>
      <section aria-labelledby="network-heading" className="space-y-3">
        <h2 id="network-heading" className="text-sm font-medium text-muted-foreground">Your network</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Personally referred" value={overview.referrals.toLocaleString()} hint={`${overview.activeReferrals} active affiliate${overview.activeReferrals === 1 ? "" : "s"}`} />
          <Stat label="Left branch" value={`${node.leftCount.toLocaleString()} members`} hint={`${volume.left.qualifyingPv.toLocaleString()} PV eligible now`} />
          <Stat label="Right branch" value={`${node.rightCount.toLocaleString()} members`} hint={`${volume.right.qualifyingPv.toLocaleString()} PV eligible now`} />
          <Stat label="Personal volume" value={`${node.personalPv.toLocaleString()} PV`} hint="From your own and your customers' purchases" />
        </div>
      </section>
      <Card className="flex flex-wrap gap-x-8 gap-y-2 p-5 text-sm">
        <p><span className="text-muted-foreground">Sponsor:</span> {sponsor ? `${sponsor.name} (${sponsor.referralCode})` : "Company"}</p>
        <p><span className="text-muted-foreground">Placed under:</span> {parent ? parent.user.name : "Top of network"}</p>
        <p><span className="text-muted-foreground">Side:</span> {node.position?.toLowerCase() ?? "—"}</p>
        <p><span className="text-muted-foreground">Level:</span> {node.depth}</p>
        {placement && <p><span className="text-muted-foreground">Placed:</span> {formatDate(placement.createdAt)} ({placementLabel[placement.method]})</p>}
      </Card>
      {!qualified && (
        <Card className="p-5 text-sm">
          To earn binary commissions you need
          {plan.requireDirectOnEachLeg && " at least one active affiliate you personally referred on each side"}
          {plan.requireDirectOnEachLeg && plan.minPersonalPv > 0 && " and"}
          {plan.minPersonalPv > 0 && ` ${plan.minPersonalPv} PV from your customers' orders`}.
          Volume keeps building in the meantime. <Link href="/compensation" className="text-primary underline">See the plan</Link>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Volume</CardTitle>
          <CardDescription>PV is counted only from paid product orders, and only after the refund window. Joining, recruiting or filling a position adds no volume.</CardDescription>
        </CardHeader>
        <CardContent><VolumeTable v={volume} /></CardContent>
      </Card>
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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent attributed sales</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/dashboard/sales">View all</Link></Button>
          </CardHeader>
          <CardContent>
            {overview.recentSales.length === 0 ? <Empty>No paid orders from your referrals yet.</Empty> : (
              <ul className="divide-y text-sm">
                {overview.recentSales.map((o) => {
                  const c = o.commissions[0];
                  return (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="font-medium">{o.number}</span> <span className="text-muted-foreground">{o.buyer} · {o.paidAt ? formatDate(o.paidAt) : ""}</span>
                        <span className="ml-2"><StatusBadge status={o.status} /></span>
                      </span>
                      <span className="text-right tabular-nums">
                        {m(o.subtotalMinor - o.discountMinor)}
                        <span className="block text-xs text-muted-foreground">{c ? `you earn ${m(c.amountMinor - c.reversedMinor)}` : "no commission"}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent withdrawals</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/dashboard/payouts">View all</Link></Button>
          </CardHeader>
          <CardContent>
            {overview.payouts.length === 0 ? <Empty>No withdrawals yet.</Empty> : (
              <ul className="divide-y text-sm">
                {overview.payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <span><StatusBadge status={p.status} /> <span className="ml-2 text-muted-foreground">{formatDate(p.settledAt ?? p.createdAt)}</span></span>
                    <span className="tabular-nums">{m(p.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Notifications {overview.unread > 0 && <Badge tone="primary" className="ml-1 align-middle">{overview.unread} new</Badge>}</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/notifications">View all</Link></Button>
          </CardHeader>
          <CardContent>
            {overview.notifications.length === 0 ? <Empty>No notifications yet.</Empty> : (
              <ul className="divide-y text-sm">
                {overview.notifications.map((n) => (
                  <li key={n.id} className="py-2">
                    <p className={n.readAt ? "" : "font-medium"}>{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Profile and security</CardTitle>
            <CardDescription>Keep your details current and protect your earnings with two-step sign-in.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/account">Profile</Link></Button>
            <Button asChild variant="outline"><Link href="/account/security">Password and two-step sign-in</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard/payouts">Bank account</Link></Button>
            <Button asChild variant="outline"><Link href="/account/addresses">Addresses</Link></Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}