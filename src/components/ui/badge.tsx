import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      primary: "bg-primary/10 text-primary",
      success: "bg-success/10 text-success",
      warning: "bg-warning/10 text-warning",
      danger: "bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

const STATUS_TONE: Record<string, VariantProps<typeof badge>["tone"]> = {
  PENDING_PAYMENT: "warning", PAID: "primary", SHIPPED: "primary", DELIVERED: "success", CANCELLED: "neutral", REFUNDED: "danger",
  REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", REVERSED: "danger", PENDING: "warning", HELD: "danger",
  OPEN: "warning", ANSWERED: "primary", CLOSED: "neutral",
  ACTIVE: "success", SUSPENDED: "danger",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}
