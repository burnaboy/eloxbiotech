import Link from "next/link";
import { ChevronDown, UserRound } from "lucide-react";
import type { TreeNodeView } from "@/lib/tree-view";
import { cn } from "@/lib/utils";

function NodeCard({ n, href, root }: { n: TreeNodeView; href: string; root?: boolean }) {
  return (
    <Link
      href={href}
      aria-label={`${n.name}, ${n.referralCode}${n.hasMore ? ", open to see members below" : ""}`}
      className={cn(
        "flex w-36 flex-col items-center rounded-lg border bg-card p-2 text-center text-xs shadow-sm hover:border-primary",
        root && "border-primary ring-1 ring-primary",
        n.status !== "ACTIVE" && "opacity-60",
      )}
    >
      <UserRound className="h-5 w-5 text-primary" aria-hidden />
      <span className="line-clamp-1 font-medium">{n.name}</span>
      <span className="text-muted-foreground">{n.referralCode}</span>
      <span className="mt-1 tabular-nums text-muted-foreground">
        L {n.leftCount} · {n.leftCarryPv} PV | R {n.rightCount} · {n.rightCarryPv} PV
      </span>
      {n.hasMore && <span className="mt-1 inline-flex items-center gap-0.5 font-medium text-primary"><ChevronDown className="h-3 w-3" aria-hidden />{n.leftCount + n.rightCount} below</span>}
    </Link>
  );
}

function EmptySlot({ label }: { label: string }) {
  return <div className="flex h-[84px] w-36 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">{label}</div>;
}

function Branch({ n, level, max, hrefFor }: { n: TreeNodeView | null; level: number; max: number; hrefFor: (id: string) => string }) {
  if (!n) return <EmptySlot label="Open" />;
  return (
    <div className="flex flex-col items-center gap-3">
      <NodeCard n={n} href={hrefFor(n.id)} root={level === 0} />
      {level < max && (
        <div className="flex gap-3 border-t pt-3">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Left</span>
            <Branch n={n.left} level={level + 1} max={max} hrefFor={hrefFor} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Right</span>
            <Branch n={n.right} level={level + 1} max={max} hrefFor={hrefFor} />
          </div>
        </div>
      )}
    </div>
  );
}

export function BinaryTree({ root, levels = 3, basePath }: { root: TreeNodeView; levels?: number; basePath: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-6" role="tree" aria-label="Binary tree">
      <div className="mx-auto w-fit">
        <Branch n={root} level={0} max={levels} hrefFor={(id) => `${basePath}?n=${id}`} />
      </div>
    </div>
  );
}
