import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney, bpsToPercent } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { saveDiscountAction, toggleDiscountAction } from "../actions";

export default async function Discounts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("SETTINGS");
  const [codes, brand] = await Promise.all([prisma.discountCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 }), getBrand()]);
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Discount codes</h1>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader>
          <CardTitle>New code</CardTitle>
          <CardDescription>Discounts reduce the eligible sale, so commissions are worked out on what the customer actually pays. Creating a code needs a fresh authenticator code.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveDiscountAction} className="grid gap-3 sm:grid-cols-3">
            <Input name="code" placeholder="CODE" aria-label="Code" required pattern="[A-Za-z0-9_-]{3,40}" />
            <Input name="description" placeholder="Shown to shoppers, e.g. 10% off launch week" aria-label="Description" required className="sm:col-span-2" />
            <Select name="type" aria-label="Type" defaultValue="PERCENT"><option value="PERCENT">Percentage off</option><option value="FIXED">Fixed amount off (₦)</option></Select>
            <Input name="value" placeholder="10 (percent) or 1500 (naira)" aria-label="Value" required inputMode="decimal" />
            <Input name="maxDiscount" placeholder="Cap for percentage codes (₦, optional)" aria-label="Maximum discount" inputMode="decimal" />
            <Input name="minSubtotal" placeholder="Minimum spend (₦, optional)" aria-label="Minimum spend" inputMode="decimal" />
            <Input name="maxRedemptions" placeholder="Total uses (optional)" aria-label="Total uses" inputMode="numeric" />
            <Input name="perCustomerLimit" placeholder="Uses per customer" aria-label="Uses per customer" inputMode="numeric" defaultValue="1" />
            <label className="text-sm">Starts<Input name="startsAt" type="datetime-local" aria-label="Starts" /></label>
            <label className="text-sm">Ends<Input name="endsAt" type="datetime-local" aria-label="Ends" /></label>
            <div className="self-end"><Button>Create code</Button></div>
          </form>
        </CardContent>
      </Card>
      {codes.length === 0 ? <Empty>No discount codes yet.</Empty> : (
        <div className="space-y-2">
          {codes.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium"><code>{c.code}</code> · {c.type === "PERCENT" ? `${bpsToPercent(c.value)}% off` : `${m(c.value)} off`}{c.maxDiscountMinor ? ` (max ${m(c.maxDiscountMinor)})` : ""} {c.active ? <Badge tone="success">active</Badge> : <Badge>off</Badge>}</p>
                <p className="text-muted-foreground">
                  {c.description} · used {c.redeemedCount}{c.maxRedemptions !== null ? ` of ${c.maxRedemptions}` : ""} · {c.perCustomerLimit} per customer
                  {c.minSubtotalMinor ? ` · min spend ${m(c.minSubtotalMinor)}` : ""}{c.startsAt ? ` · from ${formatDate(c.startsAt)}` : ""}{c.endsAt ? ` · until ${formatDate(c.endsAt)}` : ""}
                </p>
              </div>
              <form action={toggleDiscountAction.bind(null, c.id, !c.active)}><Button size="sm" variant="outline">{c.active ? "Switch off" : "Switch on"}</Button></form>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
