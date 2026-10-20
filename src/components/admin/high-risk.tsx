import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

/**
 * Fields every high-risk admin action needs: a reason (kept in the audit log) and, where set,
 * a typed confirmation word. The server checks both; these fields only collect them.
 */
export function ReasonFields({ confirm, idPrefix = "hr", reasonLabel = "Reason (kept in the audit log)" }: { confirm?: string; idPrefix?: string; reasonLabel?: string }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-reason`} className="block text-xs font-medium">{reasonLabel}</label>
      <Textarea id={`${idPrefix}-reason`} name="reason" rows={2} minLength={5} maxLength={300} required />
      {confirm && (
        <>
          <label htmlFor={`${idPrefix}-confirm`} className="block text-xs font-medium">Type <strong>{confirm}</strong> to confirm</label>
          <Input id={`${idPrefix}-confirm`} name="confirm" autoComplete="off" required pattern={confirm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} />
        </>
      )}
    </div>
  );
}

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  label: string;
  confirm?: string;
  description?: React.ReactNode;
  variant?: "default" | "outline" | "destructive" | "ghost";
  size?: "default" | "sm";
  id: string;
};

/** A button that opens a small form asking for a reason (and a confirmation word) before it submits. Works without JavaScript. */
export function ConfirmAction({ action, label, confirm, description, variant = "outline", size = "default", id }: Props) {
  return (
    <details className="group relative">
      <summary className={cn(buttonVariants({ variant, size }), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>{label}</summary>
      <form action={action} className="mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border bg-card p-3 text-sm shadow-sm">
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <ReasonFields confirm={confirm} idPrefix={id} />
        <Button size="sm" variant={variant === "destructive" ? "destructive" : "default"}>{label}</Button>
      </form>
    </details>
  );
}
