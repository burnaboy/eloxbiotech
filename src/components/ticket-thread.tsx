import type { SupportMessage } from "@prisma/client";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function TicketThread({ messages, staffView }: { messages: SupportMessage[]; staffView?: boolean }) {
  return (
    <ul className="space-y-3">
      {messages.map((m) => {
        const mine = staffView ? m.isStaff : !m.isStaff;
        return (
          <li key={m.id} className={cn("max-w-[85%] rounded-lg border p-3 text-sm", mine ? "ml-auto bg-primary/5" : "bg-card")}>
            <p className="mb-1 text-xs text-muted-foreground">{m.isStaff ? "Support team" : "Member"} · {formatDate(m.createdAt)}</p>
            <p className="whitespace-pre-line">{m.body}</p>
          </li>
        );
      })}
    </ul>
  );
}
