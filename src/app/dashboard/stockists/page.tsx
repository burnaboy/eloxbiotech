import Link from "next/link";
import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/table";

export const metadata = { title: "Stockist location" };

export default async function StockistsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await requireAffiliate();
  const { state } = await searchParams;
  const all = await prisma.stockist.findMany({ where: { active: true }, orderBy: [{ state: "asc" }, { city: "asc" }, { name: "asc" }] });
  const states = [...new Set(all.map((s) => s.state))];
  const list = state ? all.filter((s) => s.state === state) : all;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Stockist location</h1>
      <p className="text-sm text-muted-foreground">Places where you can buy or collect Elox products in person.</p>
      {states.length > 1 && (
        <nav aria-label="Filter by state" className="flex flex-wrap gap-2">
          {[undefined, ...states].map((s) => (
            <Link key={s ?? "all"} href={s ? `?state=${encodeURIComponent(s)}` : "?"} aria-current={state === s ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${state === s ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{s ?? "All states"}</Link>
          ))}
        </nav>
      )}
      {list.length === 0 ? <Empty>No stockists listed yet. Please check back soon.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((s) => (
            <Card key={s.id} className="space-y-2 p-5 text-sm">
              <h2 className="text-base font-semibold">{s.name}</h2>
              <p className="text-muted-foreground">{s.city}, {s.state}</p>
              <p>{s.address}</p>
              {s.hours && <p className="text-muted-foreground">Open: {s.hours}</p>}
              <div className="flex flex-wrap gap-4 pt-1">
                {s.phone && <a href={`tel:${s.phone.replace(/\s+/g, "")}`} className="text-primary underline">Call {s.phone}</a>}
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.address}, ${s.city}, ${s.state}`)}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">Get directions</a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
