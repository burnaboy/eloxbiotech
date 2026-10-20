import Link from "next/link";
import { BadgeCheck, Truck, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/table";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const brand = await getBrand();
  const products = await prisma.product.findMany({
    where: { active: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return (
    <>
      <section className="border-b bg-gradient-to-b from-primary/5 to-transparent">
        <div className="container grid gap-8 py-14 md:grid-cols-2 md:items-center">
          <div className="space-y-5">
            <p className="text-sm font-medium uppercase tracking-widest text-accent">{brand.companyName}</p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{brand.tagline}</h1>
            <p className="max-w-prose text-muted-foreground">
              Shop authentic products delivered across Nigeria. Love them? Share them with friends and earn commissions on completed sales.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg"><a href="#products">Shop now</a></Button>
              <Button asChild size="lg" variant="outline"><Link href="/compensation">How earning works</Link></Button>
            </div>
          </div>
          <ul className="grid gap-3 text-sm">
            {[
              { icon: BadgeCheck, t: "Genuine products", d: "Sourced directly and checked before dispatch." },
              { icon: Truck, t: "Nationwide delivery", d: "Tracked shipping with clear delivery updates." },
              { icon: Users, t: "Fair, transparent rewards", d: "Commissions come only from real product sales, never from sign-ups." },
            ].map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex gap-3 rounded-lg border bg-card p-4">
                <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div><p className="font-medium">{t}</p><p className="text-muted-foreground">{d}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section id="products" className="container py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">Products</h2>
          <form className="flex gap-2" role="search">
            <label htmlFor="q" className="sr-only">Search products</label>
            <input id="q" name="q" defaultValue={q} placeholder="Search products" className="h-10 rounded-md border bg-card px-3 text-sm" />
            <Button variant="outline">Search</Button>
          </form>
        </div>
        {products.length ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => <ProductCard key={p.id} product={p} currency={brand.currency} />)}
          </div>
        ) : (
          <Empty>No products found.</Empty>
        )}
      </section>
    </>
  );
}
