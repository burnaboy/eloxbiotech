import Link from "next/link";
import { Search } from "lucide-react";
import type { MemberHit } from "@/lib/tree-view";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** GET form: search terms stay in the URL, results link to that member's place in the tree. */
export function MemberSearch({ q, hits, basePath, placeholder }: { q?: string; hits: MemberHit[] | null; basePath: string; placeholder: string }) {
  return (
    <div className="space-y-2">
      <form className="flex max-w-md gap-2" role="search">
        <Input name="q" placeholder={placeholder} aria-label="Search members" defaultValue={q} />
        <Button variant="outline"><Search className="h-4 w-4" aria-hidden /> Search</Button>
      </form>
      {hits && (
        hits.length === 0 ? <p className="text-sm text-muted-foreground">No members match “{q}”.</p> : (
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Search results">
            {hits.map((h) => (
              <li key={h.nodeId}>
                <Link href={`${basePath}?n=${h.nodeId}`} className="inline-flex rounded-full border px-3 py-1 hover:border-primary">
                  {h.name} <span className="ml-1 text-muted-foreground">{h.referralCode} · level {h.depth}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
