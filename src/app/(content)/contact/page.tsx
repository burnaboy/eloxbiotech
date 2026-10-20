import { redirect } from "next/navigation";
import { z } from "zod";
import { Mail, MapPin, Phone } from "lucide-react";
import { getBrand } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Flash } from "@/components/flash";

export const metadata = { title: "Contact us" };

async function send(fd: FormData) {
  "use server";
  const parsed = z
    .object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(160), phone: z.string().trim().max(30), subject: z.string().trim().min(3).max(150), body: z.string().trim().min(10).max(5000), website: z.string().max(0) })
    .safeParse(Object.fromEntries(["name", "email", "phone", "subject", "body", "website"].map((k) => [k, String(fd.get(k) ?? "")])));
  if (!parsed.success) redirect("/contact?error=Please%20fill%20in%20every%20field%20(message%20at%20least%2010%20characters).");
  const ip = await clientIp();
  const recent = await prisma.contactMessage.count({ where: { ip, createdAt: { gte: new Date(Date.now() - 3600e3) } } });
  if (recent >= 5) redirect("/contact?error=Too%20many%20messages.%20Please%20try%20again%20later.");
  const { website: _honeypot, ...data } = parsed.data;
  await prisma.contactMessage.create({ data: { ...data, phone: data.phone || null, ip } });
  redirect("/contact?ok=Thanks!%20We%27ve%20received%20your%20message%20and%20will%20reply%20by%20email.");
}

export default async function Contact({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const b = await getBrand();
  return (
    <div className="grid max-w-5xl gap-8 md:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader><CardTitle>Contact us</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Flash sp={await searchParams} />
          <form action={send} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
              <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="phone">Phone (optional)</Label><Input id="phone" name="phone" type="tel" /></div>
              <div className="space-y-1.5"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" required /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="body">Message</Label><Textarea id="body" name="body" rows={6} required minLength={10} /></div>
            <div className="hidden" aria-hidden><label htmlFor="website">Leave empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
            <Button>Send message</Button>
          </form>
          <p className="text-sm text-muted-foreground">Already a customer? <a href="/support" className="text-primary underline">Open a support request</a> to track replies about an order.</p>
        </CardContent>
      </Card>
      <Card className="h-fit p-5 text-sm">
        <ul className="space-y-3">
          {b.supportEmail && <li className="flex gap-2"><Mail className="h-4 w-4 text-primary" aria-hidden /><a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></li>}
          {b.supportPhone && <li className="flex gap-2"><Phone className="h-4 w-4 text-primary" aria-hidden /><a href={`tel:${b.supportPhone}`}>{b.supportPhone}</a></li>}
          {b.address && <li className="flex gap-2"><MapPin className="h-4 w-4 text-primary" aria-hidden />{b.address}</li>}
          {!b.supportEmail && !b.supportPhone && !b.address && <li className="text-muted-foreground">Use the form and we'll reply by email.</li>}
        </ul>
      </Card>
    </div>
  );
}
