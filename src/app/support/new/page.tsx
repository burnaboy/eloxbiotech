import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Flash } from "@/components/flash";
import { openTicketAction } from "../actions";

export const metadata = { title: "New support request" };

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ error?: string; order?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/support/new");
  const orders = await prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, number: true } });
  return (
    <div className="container max-w-2xl space-y-4 py-10">
      <Flash sp={sp} />
      <Card>
        <CardHeader><CardTitle>How can we help?</CardTitle></CardHeader>
        <CardContent>
          <form action={openTicketAction} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" required minLength={3} maxLength={150} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="orderId">Related order (optional)</Label>
              <Select id="orderId" name="orderId" defaultValue={sp.order ?? ""}>
                <option value="">None</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="body">Message</Label><Textarea id="body" name="body" required minLength={2} maxLength={5000} rows={6} /></div>
            <Button>Send</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
