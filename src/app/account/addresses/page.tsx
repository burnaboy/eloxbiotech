import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddressForm } from "@/components/address-form";
import { deleteAddressAction } from "../actions";

export const metadata = { title: "Addresses" };

export default async function AddressesPage() {
  const user = await requireUser("/account/addresses");
  const list = await prisma.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Delivery addresses</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((a) => (
          <Card key={a.id} className="p-5 text-sm">
            <div className="mb-2 flex items-center gap-2"><span className="font-medium">{a.label}</span>{a.isDefault && <Badge tone="primary">default</Badge>}</div>
            <p>{a.name} · {a.phone}</p>
            <p>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
            <p>{a.city}, {a.state}, {a.country} {a.postal}</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-primary">Edit</summary>
              <div className="mt-3">
                <AddressForm id={a.id} defaults={{ ...a, line2: a.line2 ?? "", postal: a.postal ?? "" }} />
              </div>
            </details>
            <form action={deleteAddressAction.bind(null, a.id)} className="mt-2"><Button variant="ghost" size="sm" className="text-destructive">Delete</Button></form>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Add an address</CardTitle></CardHeader>
        <CardContent><AddressForm defaults={{ name: user.name, phone: user.phone ?? "" }} /></CardContent>
      </Card>
    </>
  );
}
