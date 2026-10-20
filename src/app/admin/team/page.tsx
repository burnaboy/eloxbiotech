import type { AdminPermission } from "@prisma/client";
import { ConfirmAction, ReasonFields } from "@/components/admin/high-risk";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { grantAdminAction, promoteSuperAction, revokeAdminAction, setAdminPermissionsAction } from "../actions";

const PERMS: { p: AdminPermission; label: string }[] = [
  { p: "ORDERS", label: "Orders & returns" }, { p: "PRODUCTS", label: "Products" }, { p: "MEMBERS", label: "Members" },
  { p: "NETWORK", label: "Network" }, { p: "COMMISSIONS", label: "Commissions" }, { p: "PAYOUTS", label: "Payouts" },
  { p: "SUPPORT", label: "Support" }, { p: "RISK", label: "Risk" }, { p: "SETTINGS", label: "Settings" }, { p: "AUDIT", label: "Audit log" }, { p: "PRODUCT_COSTS", label: "Cost prices" }, { p: "PAYOUT_DETAILS", label: "Bank details and transfer files" },
];

function PermBoxes({ current }: { current?: AdminPermission[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {PERMS.map(({ p, label }) => (
        <label key={p} className="flex items-center gap-1.5"><input type="checkbox" name={`perm_${p}`} defaultChecked={current?.includes(p)} className="h-4 w-4" /> {label}</label>
      ))}
    </div>
  );
}

export default async function Team({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const me = await requireSuperAdmin();
  const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } }, orderBy: [{ role: "desc" }, { name: "asc" }] });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Admin team</h1>
      <Flash sp={await searchParams} />
      <p className="text-sm text-muted-foreground">Every change here needs a fresh authenticator code and is recorded as a privileged action. New admins must set up two-step verification before they can do anything.</p>
      <Card>
        <CardHeader><CardTitle>Add an administrator</CardTitle><CardDescription>They need an existing account. Give only the areas they need.</CardDescription></CardHeader>
        <CardContent>
          <form action={grantAdminAction} className="space-y-3">
            <Input name="email" type="email" placeholder="Their account email" aria-label="Email" required className="max-w-sm" />
            <PermBoxes />
            <div className="max-w-sm"><ReasonFields idPrefix="grant" /></div>
            <Button>Grant access</Button>
          </form>
        </CardContent>
      </Card>
      {admins.map((a) => (
        <Card key={a.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{a.name}</span><span className="text-sm text-muted-foreground">{a.email}</span>
            <Badge tone={a.role === "SUPER_ADMIN" ? "primary" : "neutral"}>{a.role.replace("_", " ").toLowerCase()}</Badge>
            {a.mfaEnabledAt ? <Badge tone="success">2-step on</Badge> : <Badge tone="warning">2-step not set up</Badge>}
            {a.id === me.id && <Badge>you</Badge>}
          </div>
          {a.role === "ADMIN" && (
            <form action={setAdminPermissionsAction.bind(null, a.id)} className="space-y-2">
              <PermBoxes current={a.adminPermissions} />
              <div className="max-w-sm"><ReasonFields idPrefix={`perm-${a.id}`} /></div>
              <Button size="sm" variant="outline">Save permissions</Button>
            </form>
          )}
          {a.id !== me.id && (
            <div className="flex gap-2">
              {a.role === "ADMIN" && <ConfirmAction id={`promote-${a.id}`} action={promoteSuperAction.bind(null, a.id)} label="Make super admin" confirm="PROMOTE" size="sm" description="Super admins can change the compensation plan, tax and withdrawal settings, and other admins' access." />}
              <ConfirmAction id={`revoke-${a.id}`} action={revokeAdminAction.bind(null, a.id)} label="Remove admin access" confirm="REMOVE" size="sm" variant="destructive" />
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
