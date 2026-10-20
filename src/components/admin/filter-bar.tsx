import Link from "next/link";
import { Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  sp: Record<string, string | undefined>;
  search?: { placeholder: string; name?: string };
  dates?: boolean;
  /** Report name under /admin/export; the current filters are passed along. */
  exportReport?: string;
  children?: React.ReactNode;
};

/** Search, date range and CSV export for admin lists. A plain GET form, so filters live in the URL and can be shared. */
export function FilterBar({ sp, search, dates = true, exportReport, children }: Props) {
  const q = search?.name ?? "q";
  const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["page", "ok", "error"].includes(k)) as [string, string][]);
  return (
    <form className="flex flex-wrap items-end gap-2" role="search">
      {search && (
        <div className="space-y-1">
          <label htmlFor="f-q" className="block text-xs font-medium text-muted-foreground">Search</label>
          <Input id="f-q" name={q} defaultValue={sp[q]} placeholder={search.placeholder} className="w-64" maxLength={100} />
        </div>
      )}
      {dates && (
        <>
          <div className="space-y-1">
            <label htmlFor="f-from" className="block text-xs font-medium text-muted-foreground">From</label>
            <Input id="f-from" type="date" name="from" defaultValue={sp.from} className="w-40" />
          </div>
          <div className="space-y-1">
            <label htmlFor="f-to" className="block text-xs font-medium text-muted-foreground">To</label>
            <Input id="f-to" type="date" name="to" defaultValue={sp.to} className="w-40" />
          </div>
        </>
      )}
      {children}
      <Button variant="outline">Apply</Button>
      {[...params.keys()].length > 0 && <Button asChild variant="ghost"><Link href="?">Clear</Link></Button>}
      {exportReport && (
        <Button asChild variant="ghost" className="ml-auto">
          <a href={`/admin/export/${exportReport}?${params}`}><Download aria-hidden /> Export CSV</a>
        </Button>
      )}
    </form>
  );
}
