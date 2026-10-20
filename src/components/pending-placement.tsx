import { Clock } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Shown to an affiliate whose network position is waiting for an administrator. */
export function PendingPlacement({ requestedLeg }: { requestedLeg?: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" aria-hidden /> Your network position is being assigned</CardTitle>
        <CardDescription>
          An administrator reviews and approves each new position{requestedLeg ? ` (you asked for the ${requestedLeg.toLowerCase()} side)` : ""}.
          You can shop and share product links in the meantime. Your sponsor's commissions on your purchases still come only from completed sales.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
