import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Shows the price, with the regular price struck through when on sale. */
export function Price({ unitMinor, compareAtMinor, currency, from, className }: { unitMinor: number; compareAtMinor?: number | null; currency: string; from?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className="font-semibold">{from && <span className="text-sm font-normal text-muted-foreground">From </span>}{formatMoney(unitMinor, currency)}</span>
      {compareAtMinor ? (
        <>
          <s className="text-sm text-muted-foreground" aria-label={`was ${formatMoney(compareAtMinor, currency)}`}>{formatMoney(compareAtMinor, currency)}</s>
          <span className="sr-only">on sale</span>
        </>
      ) : null}
    </span>
  );
}
