import Link from "next/link";

export function Pager({ page, hasMore, params }: { page: number; hasMore: boolean; params: Record<string, string | undefined> }) {
  const href = (p: number) => `?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="flex justify-between text-sm">
      {page > 1 ? <Link href={href(page - 1)} className="text-primary underline">Previous</Link> : <span />}
      {hasMore && <Link href={href(page + 1)} className="text-primary underline">Next</Link>}
    </div>
  );
}
