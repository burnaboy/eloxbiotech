import Link from "next/link";
import { BadgeCheck, CreditCard, PackageCheck, RotateCcw, Share2, Truck, Users, Wallet } from "lucide-react";
import { prisma } from "@/lib/db";
import { getBrand, getShopSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function Home() {
  const [brand, shop, categories, featured, testimonials] = await Promise.all([
    getBrand(),
    getShopSettings(),
    prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: { where: { active: true } } } } } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ featured: "desc" }, { createdAt: "desc" }], take: 8 }),
    // Only quotes a customer agreed to share and an admin published.
    prisma.testimonial.findMany({ where: { published: true, consentConfirmed: true }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);
  return (
    <>
      <section className="border-b bg-gradient-to-b from-primary/10 via-primary/5 to-transparent">
        <div className="container grid gap-10 py-16 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div className="space-y-6">
            <p className="text-sm font-medium uppercase tracking-widest text-accent">{brand.companyName}</p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{brand.tagline}</h1>
            <p className="max-w-prose text-lg text-muted-foreground">Shop authentic products delivered across Nigeria. Love them? Share them and earn a commission on every completed sale.</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/products">Shop now</Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="/affiliate-programme">Become an affiliate</Link></Button>
            </div>
            <form action="/search" role="search" className="flex max-w-md gap-2">
              <label htmlFor="hero-q" className="sr-only">Search products</label>
              <input id="hero-q" name="q" placeholder="What are you looking for?" className="h-11 flex-1 rounded-md border bg-card px-3 text-sm" />
              <Button size="lg" variant="accent">Search</Button>
            </form>
          </div>
          <Card className="grid gap-4 p-6">
            {[
              { icon: BadgeCheck, t: "Genuine products", d: "Sourced directly and checked before dispatch." },
              { icon: CreditCard, t: "Secure payment", d: "Pay with card, transfer or USSD through Paystack." },
              { icon: RotateCcw, t: `${shop.returnWindowDays}-day returns`, d: "Request a return from your order page." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><Icon className="h-5 w-5 text-primary" aria-hidden /></span>
                <div><p className="font-medium">{t}</p><p className="text-sm text-muted-foreground">{d}</p></div>
              </div>
            ))}
          </Card>
        </div>
      </section>

      {categories.length > 0 && (
        <section className="container py-12" aria-labelledby="cat-h">
          <h2 id="cat-h" className="mb-6 text-2xl font-semibold tracking-tight">Shop by category</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {categories.map((c) => (
              <Link key={c.id} href={`/category/${c.slug}`} className="rounded-lg border bg-card p-5 transition-colors hover:border-primary">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">{c._count.products} product{c._count.products === 1 ? "" : "s"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="container py-12" aria-labelledby="feat-h">
        <div className="mb-6 flex items-end justify-between">
          <h2 id="feat-h" className="text-2xl font-semibold tracking-tight">Featured products</h2>
          <Link href="/products" className="text-sm text-primary underline">View all</Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {featured.map((p) => <ProductCard key={p.id} product={p} currency={brand.currency} />)}
        </div>
      </section>

      <section className="border-y bg-muted/40" aria-labelledby="del-h">
        <div className="container grid gap-8 py-12 md:grid-cols-2">
          <div className="space-y-3">
            <h2 id="del-h" className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Truck className="h-6 w-6 text-primary" aria-hidden /> Delivery</h2>
            <p className="text-muted-foreground">{shop.deliveryInfo}</p>
            <p className="text-muted-foreground">
              Delivery is {formatMoney(shop.flatShippingMinor, brand.currency)} per order{shop.freeShippingOverMinor > 0 ? ` and free over ${formatMoney(shop.freeShippingOverMinor, brand.currency)}` : ""}. You'll get tracking details when your order ships.
            </p>
            <Link href="/legal/shipping" className="text-sm text-primary underline">Shipping policy</Link>
          </div>
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><PackageCheck className="h-6 w-6 text-primary" aria-hidden /> Shopping with us</h2>
            <ul className="space-y-2 text-muted-foreground">
              <li>Clear prices, with delivery shown before you pay.</li>
              <li>Items are reserved while you complete payment.</li>
              <li>Order tracking, receipts and support from your account.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="container py-12" aria-labelledby="aff-h">
        <h2 id="aff-h" className="mb-2 text-2xl font-semibold tracking-tight">Earn by sharing products you like</h2>
        <p className="mb-6 max-w-prose text-muted-foreground">Our affiliate programme is free to join. Commissions come only from genuine product sales. Nobody is paid for signing people up.</p>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Users, t: "1. Join free", d: "No fees, starter packs or stock to buy." },
            { icon: Share2, t: "2. Share your link", d: "Send product links to people who'd value them." },
            { icon: Wallet, t: "3. Earn on completed sales", d: "Commissions clear after the return window, then you can withdraw." },
          ].map(({ icon: Icon, t, d }) => (
            <Card key={t} className="p-5">
              <Icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
              <p className="font-medium">{t}</p>
              <p className="text-sm text-muted-foreground">{d}</p>
            </Card>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link href="/affiliate-programme" className="text-primary underline">How the programme works</Link>
          <Link href="/compensation" className="text-primary underline">Compensation plan</Link>
          <Link href="/legal/earnings-disclaimer" className="text-primary underline">Earnings disclaimer</Link>
        </div>
      </section>

      {testimonials.length > 0 && (
        <section className="container pb-12" aria-labelledby="t-h">
          <h2 id="t-h" className="mb-6 text-2xl font-semibold tracking-tight">What customers say</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure key={t.id} className="rounded-lg border bg-card p-5">
                <blockquote className="text-sm">“{t.quote}”</blockquote>
                <figcaption className="mt-3 text-sm font-medium">{t.name}{t.location ? <span className="text-muted-foreground">, {t.location}</span> : null}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
