import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { deleteStockistAction, saveStockistAction } from "../actions";

export const metadata = { title: "Stockists" };

type S = { name: string; state: string; city: string; address: string; phone: string | null; hours: string | null; active: boolean };

function Fields({ s }: { s?: S }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input name="name" defaultValue={s?.name} placeholder="Stockist name" aria-label="Name" required />
        <Input name="city" defaultValue={s?.city} placeholder="City" aria-label="City" required />
        <Input name="state" defaultValue={s?.state} placeholder="State, e.g. Lagos" aria-label="State" required />
      </div>
      <Input name="address" defaultValue={s?.address} placeholder="Street address" aria-label="Address" required />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="phone" defaultValue={s?.phone ?? ""} placeholder="Phone (optional)" aria-label="Phone" inputMode="tel" />
        <Input name="hours" defaultValue={s?.hours ?? ""} placeholder="Opening hours (optional), e.g. Mon–Sat 9am–6pm" aria-label="Opening hours" />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} className="h-4 w-4" /> Shown to members</label>
    </div>
  );
}

export default async function Stockists({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("PRODUCTS");
  const list = await prisma.stockist.findMany({ orderBy: [{ state: "asc" }, { city: "asc" }, { name: "asc" }] });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Stockists</h1>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader>
          <CardTitle>Add a stockist</CardTitle>
          <CardDescription>Members see active stockists on the Stockist location page in their dashboard, grouped by state.</CardDescription>
        </CardHeader>
        <CardContent><form action={saveStockistAction.bind(null, null)} className="space-y-3"><Fields /><Button>Add</Button></form></CardContent>
      </Card>
      {list.map((s) => (
        <Card key={s.id} className="space-y-3 p-5">
          <div className="flex gap-2">{s.active ? <Badge tone="success">shown</Badge> : <Badge>hidden</Badge>}</div>
          <form action={saveStockistAction.bind(null, s.id)} className="space-y-3"><Fields s={s} /><Button variant="outline">Save</Button></form>
          <form action={deleteStockistAction.bind(null, s.id)}><Button variant="ghost" size="sm" className="text-destructive">Delete</Button></form>
        </Card>
      ))}
    </>
  );
}
