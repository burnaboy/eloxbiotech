import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/table";

export const metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const user = await requireUser("/notifications");
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const user = await requireUser("/notifications");
  const list = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="container max-w-3xl space-y-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        {list.some((n) => !n.readAt) && <form action={markAllRead}><Button variant="outline" size="sm">Mark all as read</Button></form>}
      </div>
      {list.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.map((n) => (
            <li key={n.id} className={`flex gap-3 p-4 ${n.readAt ? "" : "bg-primary/5"}`}>
              {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
              <div className="flex-1">
                <p className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                <p className="text-sm text-muted-foreground">{n.body}</p>
              </div>
              <time className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(n.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
