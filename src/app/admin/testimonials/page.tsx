import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { deleteTestimonialAction, saveTestimonialAction } from "../actions";

function Fields({ t }: { t?: { name: string; location: string | null; quote: string; consentConfirmed: boolean; published: boolean } }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="name" defaultValue={t?.name} placeholder="Customer name as they agreed to be shown" aria-label="Name" required />
        <Input name="location" defaultValue={t?.location ?? ""} placeholder="City (optional)" aria-label="Location" />
      </div>
      <Textarea name="quote" defaultValue={t?.quote} placeholder="Their exact words" aria-label="Quote" required rows={3} />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="consentConfirmed" defaultChecked={t?.consentConfirmed} className="h-4 w-4" /> I have the customer's written consent to publish this</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="published" defaultChecked={t?.published} className="h-4 w-4" /> Published</label>
      </div>
    </div>
  );
}

export default async function Testimonials({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("PRODUCTS");
  const list = await prisma.testimonial.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Testimonials</h1>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader>
          <CardTitle>Add a testimonial</CardTitle>
          <CardDescription>Only real customer words, with their consent. Never write or edit quotes, and never include income claims. The homepage section stays hidden until at least one is published.</CardDescription>
        </CardHeader>
        <CardContent><form action={saveTestimonialAction.bind(null, null)} className="space-y-3"><Fields /><Button>Add</Button></form></CardContent>
      </Card>
      {list.map((t) => (
        <Card key={t.id} className="space-y-3 p-5">
          <div className="flex gap-2">{t.published ? <Badge tone="success">published</Badge> : <Badge>draft</Badge>}{!t.consentConfirmed && <Badge tone="warning">no consent recorded</Badge>}</div>
          <form action={saveTestimonialAction.bind(null, t.id)} className="space-y-3"><Fields t={t} /><Button variant="outline">Save</Button></form>
          <form action={deleteTestimonialAction.bind(null, t.id)}><Button variant="ghost" size="sm" className="text-destructive">Delete</Button></form>
        </Card>
      ))}
    </>
  );
}
