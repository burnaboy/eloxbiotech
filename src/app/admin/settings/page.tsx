import { requireAdmin } from "@/lib/session";
import { getBrand, getShopSettings } from "@/lib/settings";
import { currentPlanVersion, rulesOf } from "@/lib/comp-plan";
import { bpsToPercent } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Flash } from "@/components/flash";
import { saveBrandAction, saveCompPlanAction, saveFinanceAction, saveShopAction } from "../actions";
import { ReasonFields } from "@/components/admin/high-risk";

function F({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const admin = await requireAdmin("SETTINGS");
  const [b, s, version, history] = await Promise.all([getBrand(), getShopSettings(), currentPlanVersion(), prisma.compPlanVersion.findMany({ orderBy: { version: "desc" }, take: 10 })]);
  const p = rulesOf(version);
  const major = (v: number) => (v / 100).toString();
  const isSuper = admin.role === "SUPER_ADMIN";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader><CardTitle>Brand</CardTitle><CardDescription>Name, logo and colours used across the site.</CardDescription></CardHeader>
        <CardContent>
          <form action={saveBrandAction} className="grid gap-4 sm:grid-cols-2">
            <F id="companyName" label="Company name"><Input id="companyName" name="companyName" defaultValue={b.companyName} required /></F>
            <F id="tagline" label="Tagline"><Input id="tagline" name="tagline" defaultValue={b.tagline} /></F>
            <F id="logoUrl" label="Logo URL" hint="Square image, https only. Leave empty for the default icon."><Input id="logoUrl" name="logoUrl" defaultValue={b.logoUrl} /></F>
            <div className="grid grid-cols-3 gap-3">
              <F id="primaryColor" label="Primary colour"><Input id="primaryColor" name="primaryColor" type="color" defaultValue={b.primaryColor} className="h-10 p-1" /></F>
              <F id="accentColor" label="Accent colour"><Input id="accentColor" name="accentColor" type="color" defaultValue={b.accentColor} className="h-10 p-1" /></F>
              <F id="currency" label="Currency">
                <Select id="currency" name="currency" defaultValue={b.currency}>{["NGN", "GHS", "ZAR", "KES", "USD"].map((c) => <option key={c}>{c}</option>)}</Select>
              </F>
            </div>
            <F id="supportEmail" label="Support email"><Input id="supportEmail" name="supportEmail" type="email" defaultValue={b.supportEmail} /></F>
            <F id="supportPhone" label="Support phone"><Input id="supportPhone" name="supportPhone" defaultValue={b.supportPhone} /></F>
            <F id="address" label="Business address"><Input id="address" name="address" defaultValue={b.address} /></F>
            <F id="registrationNumber" label="CAC registration number"><Input id="registrationNumber" name="registrationNumber" defaultValue={b.registrationNumber} /></F>
            <div className="sm:col-span-2"><F id="about" label="About us text" hint="Shown on the About page. Leave blank paragraphs between sections."><Textarea id="about" name="about" rows={5} defaultValue={b.about} /></F></div>
            <div><Button>Save brand</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Shop and delivery</CardTitle></CardHeader>
        <CardContent>
          <form action={saveShopAction} className="grid gap-4 sm:grid-cols-3">
            <F id="flatShipping" label="Delivery fee (₦)"><Input id="flatShipping" name="flatShipping" inputMode="decimal" defaultValue={major(s.flatShippingMinor)} /></F>
            <F id="freeShippingOver" label="Free delivery over (₦)" hint="0 turns it off"><Input id="freeShippingOver" name="freeShippingOver" inputMode="decimal" defaultValue={major(s.freeShippingOverMinor)} /></F>
            <F id="orderExpiryMinutes" label="Hold stock for unpaid orders (minutes)"><Input id="orderExpiryMinutes" name="orderExpiryMinutes" inputMode="numeric" defaultValue={s.orderExpiryMinutes} /></F>
            <F id="returnWindowDays" label="Return window (days)"><Input id="returnWindowDays" name="returnWindowDays" inputMode="numeric" defaultValue={s.returnWindowDays} /></F>
            <F id="perKgShipping" label="Extra delivery per kg (₦)" hint="Added per started kilogram. 0 = flat fee only"><Input id="perKgShipping" name="perKgShipping" inputMode="decimal" defaultValue={major(s.perKgShippingMinor)} /></F>
            <div className="sm:col-span-3"><F id="deliveryInfo" label="Delivery information"><Textarea id="deliveryInfo" name="deliveryInfo" rows={2} defaultValue={s.deliveryInfo} /></F></div>
            <div><Button>Save shop settings</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tax and withdrawals</CardTitle>
          <CardDescription>Sensitive financial settings. Only a super administrator can change them, with a fresh authenticator code and a reason.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSuper && <Alert>Only a super administrator can change these.</Alert>}
          <form action={saveFinanceAction} className="grid gap-4 sm:grid-cols-3">
            <fieldset disabled={!isSuper} className="contents">
              <F id="minPayout" label="Minimum withdrawal (₦)"><Input id="minPayout" name="minPayout" inputMode="decimal" defaultValue={major(s.minPayoutMinor)} /></F>
                <fieldset className="space-y-3 rounded-md border p-3 sm:col-span-3">
              <legend className="px-1 text-sm font-medium">VAT</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxEnabled" defaultChecked={s.taxEnabled} className="h-4 w-4" /> Charge VAT (only once the business is VAT-registered)</label>
              <div className="grid gap-4 sm:grid-cols-3">
                <F id="taxRate" label="Rate (%)" hint="Nigeria's standard rate is 7.5%"><Input id="taxRate" name="taxRate" inputMode="decimal" defaultValue={bpsToPercent(s.taxRateBps)} /></F>
                <F id="taxLabel" label="Label on receipts"><Input id="taxLabel" name="taxLabel" defaultValue={s.taxLabel} maxLength={20} /></F>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pricesIncludeTax" defaultChecked={s.pricesIncludeTax} className="h-4 w-4" /> Shelf prices already include VAT (otherwise VAT is added at checkout)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxShipping" defaultChecked={s.taxShipping} className="h-4 w-4" /> Delivery charges are subject to VAT</label>
            </fieldset>
              <div className="sm:col-span-3 max-w-md"><ReasonFields idPrefix="finance" /></div>
              <div><Button>Save tax and withdrawal settings</Button></div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Compensation plan</CardTitle>
          <CardDescription>Placeholder numbers until the business approves the plan. Each save becomes a new, permanent version (now version {version.version}). Orders keep the version in force when they were paid.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSuper && <Alert>Only a super administrator can change the compensation plan.</Alert>}
          <form action={saveCompPlanAction} className="grid gap-4 sm:grid-cols-3">
            <fieldset disabled={!isSuper} className="contents">
              <F id="directRate" label="Direct commission (%)" hint="Of eligible net sales: after discount, excluding VAT and delivery"><Input id="directRate" name="directRate" inputMode="decimal" defaultValue={bpsToPercent(p.directRateBps)} /></F>
              <F id="pairUnitPv" label="PV per pairing unit"><Input id="pairUnitPv" name="pairUnitPv" inputMode="numeric" defaultValue={p.pairUnitPv} /></F>
              <F id="pairingRatio" label="Pairing ratio"><Select id="pairingRatio" name="pairingRatio" defaultValue={p.pairingRatio}><option value="1:1">1:1</option><option value="2:1">2:1 either way</option></Select></F>
              <F id="pairValue" label="Pay per pair (₦)"><Input id="pairValue" name="pairValue" inputMode="decimal" defaultValue={major(p.pairValueMinor)} /></F>
              <F id="dailyCap" label="Daily cap per member (₦)" hint="0 = no cap"><Input id="dailyCap" name="dailyCap" inputMode="decimal" defaultValue={major(p.dailyCapMinor)} /></F>
              <F id="maxCarryPv" label="Max carry-forward PV per side" hint="0 = unlimited"><Input id="maxCarryPv" name="maxCarryPv" inputMode="numeric" defaultValue={p.maxCarryPv} /></F>
              <F id="holdDays" label="Hold before approval (days)"><Input id="holdDays" name="holdDays" inputMode="numeric" defaultValue={p.holdDays} /></F>
              <F id="minPersonalPv" label="Personal PV to qualify" hint="From the affiliate's customers' orders"><Input id="minPersonalPv" name="minPersonalPv" inputMode="numeric" defaultValue={p.minPersonalPv} /></F>
              <F id="defaultPlacement" label="Default placement"><Select id="defaultPlacement" name="defaultPlacement" defaultValue={p.defaultPlacement}><option value="WEAKER_LEG">Weaker side</option><option value="LEFT">Left</option><option value="RIGHT">Right</option></Select></F>
              <F id="placementMode" label="Placement of new affiliates" hint="Approval: an admin chooses each new affiliate's position"><Select id="placementMode" name="placementMode" defaultValue={p.placementMode}><option value="AUTO">Automatic</option><option value="ADMIN_APPROVAL">Admin approval</option></Select></F>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="carryForward" defaultChecked={p.carryForward} className="h-4 w-4" /> Carry unmatched volume forward</label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="requireDirectOnEachLeg" defaultChecked={p.requireDirectOnEachLeg} className="h-4 w-4" /> Require a personal referral on each side to earn team commission (not recommended: makes recruiting a condition of pay)</label>
              <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="binaryRetailOnly" defaultChecked={p.binaryRetailOnly} className="h-4 w-4" /> Only customer orders build team volume (recommended: affiliates&apos; own purchases don&apos;t count)</label>
              <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="directOnMemberPurchases" defaultChecked={p.directOnMemberPurchases} className="h-4 w-4" /> Pay direct commission on affiliates&apos; own purchases (off: only retail sales to customers count)</label>
              <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="binaryEnabled" defaultChecked={p.binaryEnabled} className="h-4 w-4" /> Pay binary team commissions. Leave off until the binary rules, caps and refund treatment are approved.</label>
              <div className="sm:col-span-3"><F id="versionNote" label="What changed and who approved it" hint="Kept permanently with this plan version"><Input id="versionNote" name="versionNote" required minLength={5} maxLength={300} /></F></div>
              <div className="sm:col-span-3 max-w-xs"><F id="planConfirm" label="Type PUBLISH to confirm"><Input id="planConfirm" name="confirm" required autoComplete="off" pattern="PUBLISH" /></F></div>
              <div><Button>Save as new version</Button></div>
            </fieldset>
          </form>
          <div className="text-sm">
            <p className="mb-1 font-medium">Version history</p>
            <ul className="space-y-1 text-muted-foreground">
              {history.map((h) => <li key={h.id}>Version {h.version} · {formatDate(h.createdAt)}{h.note ? ` · ${h.note}` : ""}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
