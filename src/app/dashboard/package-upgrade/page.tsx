import Link from "next/link";
import { requireAffiliate } from "@/lib/session";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { packagesFor } from "@/lib/packages";
import { Stat } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/table";

export const metadata = { title: "Package upgrade" };

export default async function PackageUpgradePage() {
  const user = await requireAffiliate();
  const [{ list, current }, brand] = await Promise.all([packagesFor(user.id), getBrand()]);
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Package upgrade</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Your package" value={current ? current.name : "None yet"} hint={current ? `Bought for ${m(current.listPriceMinor)}` : "Buy a package below to get started"} />
        <Stat label="Packages available" value={list.length.toLocaleString()} hint="Paid through the normal checkout" />
      </div>
      {list.length === 0 ? (
        <Empty>No packages are on sale yet. Staff can add them as products in the &ldquo;Packages&rdquo; category.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const isCurrent = current?.id === p.id;
            const lower = current && p.listPriceMinor < current.listPriceMinor;
            return (
              <Card key={p.id} className={`flex flex-col gap-3 p-5 ${isCurrent ? "border-primary" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  {isCurrent && <Badge tone="primary">current</Badge>}
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
                <p className="text-xl font-semibold tabular-nums">{m(p.listPriceMinor)} <span className="text-sm font-normal text-muted-foreground">{p.pv} PV</span></p>
                <div className="mt-auto">
                  {isCurrent ? <Button variant="outline" disabled>Your package</Button>
                    : lower ? <Button variant="ghost" disabled>Included in yours</Button>
                    : p.stock <= 0 ? <Button variant="outline" disabled>Out of stock</Button>
                    : <Button asChild><Link href={`/products/${p.slug}`}>{current ? "Upgrade" : "Choose"}</Link></Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">An upgrade is bought at the full price of the new package. Your package updates once the payment is confirmed.</p>
    </>
  );
}
