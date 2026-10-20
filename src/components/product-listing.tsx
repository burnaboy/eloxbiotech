import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { ProductCard, cardInclude } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Empty } from "@/components/ui/table";

export type ListingParams = { q?: string; category?: string; sort?: string; instock?: string; sale?: string; min?: string; max?: string; page?: string };

export const PAGE_SIZE = 24;

const SORTS = {
  featured: [{ featured: "desc" }, { createdAt: "desc" }],
  newest: [{ createdAt: "desc" }],
  "price-asc": [{ listPriceMinor: "asc" }, { name: "asc" }],
  "price-desc": [{ listPriceMinor: "desc" }, { name: "asc" }],
  name: [{ name: "asc" }],
} satisfies Record<string, Prisma.ProductOrderByWithRelationInput[]>;

/** Whole naira from a query string, as kobo. Integers only. */
function nairaParam(v?: string) {
  const n = Number.parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n * 100 : undefined;
}

/** Catalogue grid with search, category, price and stock filters. `basePath` decides where filter links point. */
export async function ProductListing({ sp, basePath, title, lockCategory }: { sp: ListingParams; basePath: string; title: string; lockCategory?: boolean }) {
  const q = sp.q?.trim().slice(0, 100);
  const brand = await getBrand();
  const categories = await prisma.category.findMany({ where: { active: true, parentId: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const min = nairaParam(sp.min);
  const max = nairaParam(sp.max);
  const sortKey = (sp.sort && sp.sort in SORTS ? sp.sort : "featured") as keyof typeof SORTS;
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const now = new Date();
  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    AND: [
      q ? { OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { sku: { equals: q.toUpperCase() } },
        { variants: { some: { active: true, OR: [{ sku: { equals: q.toUpperCase() } }, { name: { contains: q, mode: "insensitive" } }] } } },
        { category: { name: { contains: q, mode: "insensitive" } } },
      ] } : {},
      sp.category ? { category: { OR: [{ slug: sp.category }, { parent: { slug: sp.category } }] } } : {},
      sp.instock ? { OR: [{ stock: { gt: 0 }, variants: { none: { active: true } } }, { variants: { some: { active: true, stock: { gt: 0 } } } }] } : {},
      sp.sale ? { OR: [{ salePriceMinor: { not: null } }, { variants: { some: { active: true, salePriceMinor: { not: null } } } }], AND: [{ OR: [{ saleStartsAt: null }, { saleStartsAt: { lte: now } }] }, { OR: [{ saleEndsAt: null }, { saleEndsAt: { gt: now } }] }] } : {},
      min || max ? { listPriceMinor: { ...(min ? { gte: min } : {}), ...(max ? { lte: max } : {}) } } : {},
    ],
  };
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, include: cardInclude, orderBy: SORTS[sortKey], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const u = new URLSearchParams(Object.entries({ ...sp, page: n > 1 ? String(n) : undefined }).filter(([, v]) => v) as [string, string][]);
    return `${basePath}${u.toString() ? `?${u}` : ""}`;
  };
  const catHref = (slug?: string) => {
    const u = new URLSearchParams(Object.entries({ ...sp, category: undefined, page: undefined }).filter(([, v]) => v) as [string, string][]);
    const qs = u.toString();
    return slug ? `/category/${slug}${qs ? `?${qs}` : ""}` : `/products${qs ? `?${qs}` : ""}`;
  };
  return (
    <section className="container py-10">
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">{title}</h1>
      {categories.length > 0 && (
        <nav aria-label="Categories" className="mb-4 flex flex-wrap gap-2">
          <Link href={catHref()} className={`rounded-full border px-3 py-1 text-sm ${!sp.category ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>All</Link>
          {categories.map((c) => (
            <Link key={c.id} href={catHref(c.slug)} aria-current={sp.category === c.slug ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${sp.category === c.slug ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{c.name}</Link>
          ))}
        </nav>
      )}
      <form className="mb-6 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" action={basePath}>
        {sp.category && !lockCategory && <input type="hidden" name="category" value={sp.category} />}
        <div className="lg:col-span-2"><label htmlFor="q" className="sr-only">Search products</label><Input id="q" name="q" defaultValue={q} placeholder="Search products" /></div>
        <div><label htmlFor="sort" className="sr-only">Sort</label>
          <Select id="sort" name="sort" defaultValue={sortKey}>
            <option value="featured">Featured</option><option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name</option>
          </Select>
        </div>
        <div className="flex gap-2"><label htmlFor="min" className="sr-only">Minimum price</label><Input id="min" name="min" inputMode="numeric" placeholder="Min ₦" defaultValue={sp.min} /><label htmlFor="max" className="sr-only">Maximum price</label><Input id="max" name="max" inputMode="numeric" placeholder="Max ₦" defaultValue={sp.max} /></div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="instock" value="1" defaultChecked={!!sp.instock} className="h-4 w-4" /> In stock</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="sale" value="1" defaultChecked={!!sp.sale} className="h-4 w-4" /> On sale</label>
        </div>
        <Button variant="outline">Apply</Button>
      </form>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{total} product{total === 1 ? "" : "s"}{q ? ` matching "${q}"` : ""}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</p>
      {products.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => <ProductCard key={p.id} product={p} currency={brand.currency} />)}
        </div>
      ) : (
        <Empty>No products found. Try a different search or filter.</Empty>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-2">
          {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={pageHref(page - 1)} rel="prev">Previous</Link></Button> : <Button variant="outline" size="sm" disabled>Previous</Button>}
          <span className="px-2 text-sm text-muted-foreground">Page {page} of {pages}</span>
          {page < pages ? <Button asChild variant="outline" size="sm"><Link href={pageHref(page + 1)} rel="next">Next</Link></Button> : <Button variant="outline" size="sm" disabled>Next</Button>}
        </nav>
      )}
    </section>
  );
}
