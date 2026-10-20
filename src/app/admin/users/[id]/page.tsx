import Link from "next/link";
import { ConfirmAction } from "@/components/admin/high-risk";
import { notFound } from "next/navigation";
import { requireAdmin, canAccess } from "@/lib/session";
import { prisma } from "@/lib/db";
import { volumeSummary } from "@/lib/volume";
import { VolumeTable } from "@/components/volume-table";
import { getBrand } from "@/lib/settings";
import { walletBalance } from "@/lib/wallet";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/stat";
import { Flash } from "@/components/flash";
import { revokeSessionsAction, setUserStatusAction } from "../../actions";

export default async function Member({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const admin = await requireAdmin("MEMBERS");
  const { id } = await params;
  const u = await prisma.user.findUnique({ where: { id }, include: { node: true, sponsor: true, _count: { select: { referrals: true, orders: true } } } });
  if (!u) notFound();
  const [brand, wallet, orders, sessions, sameIp, placement, volume] = await Promise.all([
    getBrand(),
    walletBalance(u.id),
    prisma.order.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.session.findMany({ where: { userId: u.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 10 }),
    u.signupIp ? prisma.user.findMany({ where: { signupIp: u.signupIp, NOT: { id: u.id } }, select: { id: true, name: true, email: true }, take: 10 }) : [],
    prisma.placementRecord.findFirst({ where: { userId: u.id } }),
    u.node ? volumeSummary(u.node) : null,
  ]);
  const [placedUnder, placedBy, originalSponsor] = await Promise.all([
    placement?.parentId ? prisma.affiliateNode.findUnique({ where: { id: placement.parentId }, select: { user: { select: { id: true, name: true } } } }) : null,
    placement?.actorId ? prisma.user.findUnique({ where: { id: placement.actorId }, select: { name: true } }) : null,
    placement?.sponsorId ? prisma.user.findUnique({ where: { id: placement.sponsorId }, select: { id: true, name: true } }) : null,
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{u.name}</h1>
        <Badge tone="primary">{u.role.replace("_", " ").toLowerCase()}</Badge>
        <StatusBadge status={u.status} />
        {u.mfaEnabledAt && <Badge tone="success">2-step on</Badge>}
      </div>
      <Flash sp={await searchParams} />
      <p className="text-sm text-muted-foreground">
        {u.email} · {u.phone ?? "no phone"} · code {u.referralCode} · joined {formatDate(u.createdAt)} · sponsor {u.sponsor ? <Link className="text-primary underline" href={`/admin/users/${u.sponsor.id}`}>{u.sponsor.name}</Link> : "none"} · {u._count.referrals} referral(s)
      </p>
      {u.node && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Available balance" value={m(wallet.availableMinor)} hint={`${m(wallet.pendingMinor)} pending · ${m(wallet.heldMinor)} held`} />
          <Stat label="Left leg" value={`${u.node.leftCarryPv} PV`} hint={`${u.node.leftCount} members · ${u.node.leftTotalPv} PV all time`} />
          <Stat label="Right leg" value={`${u.node.rightCarryPv} PV`} hint={`${u.node.rightCount} members · ${u.node.rightTotalPv} PV all time`} />
          <Stat label="Placement" value={u.node.position?.toLowerCase() ?? "root"} hint={canAccess(admin, "NETWORK") ? <Link className="text-primary underline" href={`/admin/network?n=${u.node.id}`}>View in network</Link> : `level ${u.node.depth}`} />
        </div>
      )}
      {u.placementPending && (
        <Alert>Waiting for an administrator to assign a network position{u.requestedLeg ? ` (asked for ${u.requestedLeg.toLowerCase()})` : ""}. <Link className="text-primary underline" href="/admin/network">Open the placement queue</Link></Alert>
      )}
      {placement && (
        <Card>
          <CardHeader><CardTitle>Placement record</CardTitle><CardDescription>Recorded when the position was created. It can't be edited.</CardDescription></CardHeader>
          <CardContent className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Placed:</span> {formatDate(placement.createdAt)}</p>
            <p><span className="text-muted-foreground">Method:</span> {placement.method.replace("_", " ").toLowerCase()}</p>
            <p><span className="text-muted-foreground">Sponsor at sign-up:</span> {originalSponsor ? <Link className="text-primary underline" href={`/admin/users/${originalSponsor.id}`}>{originalSponsor.name}</Link> : "none"}</p>
            <p><span className="text-muted-foreground">Placed under:</span> {placedUnder ? <Link className="text-primary underline" href={`/admin/users/${placedUnder.user.id}`}>{placedUnder.user.name}</Link> : "network root"}{placement.position ? `, ${placement.position.toLowerCase()} side` : ""}</p>
            <p><span className="text-muted-foreground">By:</span> {placedBy?.name ?? "system"}</p>
            {placement.note && <p><span className="text-muted-foreground">Note:</span> {placement.note}</p>}
          </CardContent>
        </Card>
      )}
      {volume && (
        <Card>
          <CardHeader><CardTitle>Volume</CardTitle></CardHeader>
          <CardContent><VolumeTable v={volume} /></CardContent>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Account actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {u.status === "ACTIVE"
              ? <ConfirmAction id="suspend" action={setUserStatusAction.bind(null, u.id, "SUSPENDED")} label="Suspend" confirm="SUSPEND" variant="destructive" description="They are signed out at once and can't sign in or earn on new orders." />
              : <ConfirmAction id="reactivate" action={setUserStatusAction.bind(null, u.id, "ACTIVE")} label="Reactivate" variant="default" />}
            <ConfirmAction id="signout" action={revokeSessionsAction.bind(null, u.id)} label="Sign out everywhere" />
            <p className="w-full text-xs text-muted-foreground">Suspended members can't sign in and earn nothing on new orders. Admin roles are managed by a super administrator under Admin team.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Signals</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Sign-up IP: {u.signupIp ?? "unknown"}</p>
            {sameIp.length > 0 && (
              <div>
                <p className="font-medium text-warning">Other accounts from the same sign-up IP:</p>
                <ul>{sameIp.map((s) => <li key={s.id}><Link className="text-primary underline" href={`/admin/users/${s.id}`}>{s.name}</Link> ({s.email})</li>)}</ul>
              </div>
            )}
            <p>Active sessions: {sessions.length}</p>
            <ul className="text-xs text-muted-foreground">{sessions.map((s) => <li key={s.id}>{formatDate(s.createdAt)} · {s.ip} · {s.userAgent?.slice(0, 60)}</li>)}</ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent orders ({u._count.orders})</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {orders.map((o) => (
            <div key={o.id} className="flex justify-between"><Link className="text-primary underline" href={`/admin/orders/${o.id}`}>{o.number}</Link><span><StatusBadge status={o.status} /> {m(o.totalMinor)}</span></div>
          ))}
          {orders.length === 0 && <p className="text-muted-foreground">None.</p>}
        </CardContent>
      </Card>
    </>
  );
}
