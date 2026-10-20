import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Empty } from "@/components/ui/table";

export type ListingParams = { q?: string; category?: string; sort?: string; instock?: string; min?: string; max?: string };

const SORTS = {
  newest: { createdAt: "desc" },
  "price-asc": { priceMinor: "asc" },
  "price-desc": { priceMinor: "desc" },
  name: { name: "asc" },
} satisfies Record<string, Prisma.ProductOrderByWithRelationInput>;

/** Catalogue grid with search, category, price and stock filters. `basePath` decides where filter links point. */
export async function ProductListing({ sp, basePath, title, lockCategory }: { sp: ListingParams; basePath: string; title: string; lockCategory?: boolean }) {
  const q = sp.q?.slice(0, 100);
  const brand = await getBrand();
  const categories = await prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const min = Number(sp.min) > 0 ? Math.round(Number(sp.min) * 100) : undefined;
  const max = Number(sp.max) > 0 ? Math.round(Number(sp.max) * 100) : undefined;
  const sort = SORTS[(sp.sort as keyof typeof SORTS) ?? "newest"] ?? SORTS.newest;
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
      ...(sp.category ? { category: { slug: sp.category } } : {}),
      ...(sp.instock ? { stock: { gt: 0 } } : {}),
      ...(min || max ? { priceMinor: { ...(min ? { gte: min } : {}), ...(max ? { lte: max } : {}) } } : {}),
    },
    orderBy: sort,
    take: 120,
  });
  const catHref = (slug?: string) => {
    const u = new URLSearchParams(Object.entries({ ...sp, category: undefined }).filter(([, v]) => v) as [string, string][]);
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
          <Select id="sort" name="sort" defaultValue={sp.sort ?? "newest"}>
            <option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name</option>
          </Select>
        </div>
        <div className="flex gap-2"><label htmlFor="min" className="sr-only">Minimum price</label><Input id="min" name="min" inputMode="numeric" placeholder="Min" defaultValue={sp.min} /><label htmlFor="max" className="sr-only">Maximum price</label><Input id="max" name="max" inputMode="numeric" placeholder="Max" defaultValue={sp.max} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="instock" value="1" defaultChecked={!!sp.instock} className="h-4 w-4" /> In stock only</label>
        <Button variant="outline">Apply</Button>
      </form>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{products.length} product{products.length === 1 ? "" : "s"}{q ? ` matching "${q}"` : ""}</p>
      {products.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => <ProductCard key={p.id} product={p} currency={brand.currency} />)}
        </div>
      ) : (
        <Empty>No products found. Try a different search or filter.</Empty>
      )}
    </section>
  );
}
