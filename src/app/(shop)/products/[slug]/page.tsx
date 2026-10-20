import { notFound } from "next/navigation";
import Link from "next/link";
import { Truck, PackageX } from "lucide-react";
import { prisma } from "@/lib/db";
import { getBrand, getShopSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { lowestPrice, unitPrice } from "@/lib/catalog";
import { ProductImage } from "@/components/product-card";
import { AddToCart } from "@/components/add-to-cart";
import { Badge } from "@/components/ui/badge";
import { Price } from "@/components/price";
import { getCurrentUser } from "@/lib/session";

const load = (slug: string) =>
  prisma.product.findFirst({
    where: { slug, status: "ACTIVE" },
    include: {
      category: { include: { parent: true } },
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      variants: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await load((await params).slug);
  if (!p) return { title: "Product" };
  const description = p.metaDescription ?? p.description.slice(0, 160);
  return {
    title: p.metaTitle ?? p.name,
    description,
    openGraph: { title: p.metaTitle ?? p.name, description, images: p.images.slice(0, 1).map((i) => ({ url: i.url, width: i.width || undefined, height: i.height || undefined, alt: i.alt || p.name })) },
  };
}

function dims(p: { lengthMm: number | null; widthMm: number | null; heightMm: number | null }) {
  if (!p.lengthMm || !p.widthMm || !p.heightMm) return null;
  const cm = (mm: number) => (mm / 10).toLocaleString("en-NG", { maximumFractionDigits: 1 });
  return `${cm(p.lengthMm)} × ${cm(p.widthMm)} × ${cm(p.heightMm)} cm`;
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, brand, user, shop] = await Promise.all([load(slug), getBrand(), getCurrentUser(), getShopSettings()]);
  if (!product) notFound();
  const showPv = user && user.role !== "CUSTOMER";
  const now = new Date();
  const price = lowestPrice(product, product.variants, now);
  const variants = product.variants.map((v) => ({ id: v.id, name: v.name, stock: v.stock, ...unitPrice(product, v, now) }));
  const stock = product.variants.length ? product.variants.reduce((s, v) => s + v.stock, 0) : product.stock;
  const attributes = Object.entries((product.attributes ?? {}) as Record<string, string>);
  const size = dims(product);
  const [main, ...rest] = product.images;
  // Structured data for search engines: name, price and availability only (no ratings or reviews).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    description: product.description.slice(0, 500),
    image: product.images.map((i) => (i.url.startsWith("http") ? i.url : `${process.env.APP_URL ?? ""}${i.url}`)),
    offers: { "@type": "Offer", priceCurrency: brand.currency, price: (price.unitMinor / 100).toFixed(2), availability: stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };
  return (
    <div className="container grid gap-10 py-10 md:grid-cols-2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="space-y-3">
        <ProductImage image={main} name={product.name} className="rounded-lg border" eager />
        {rest.length > 0 && (
          <ul className="grid grid-cols-4 gap-2" aria-label="More images">
            {rest.map((img) => (
              <li key={img.id}>
                <a href={img.url} target="_blank" rel="noopener">
                  <ProductImage image={img} name={product.name} className="rounded-md border" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {product.category && <><Link href={`/category/${product.category.slug}`} className="hover:underline">{product.category.name}</Link> · </>}SKU {product.sku}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-2xl"><Price unitMinor={price.unitMinor} compareAtMinor={price.compareAtMinor} currency={brand.currency} from={variants.length > 1 && new Set(variants.map((v) => v.unitMinor)).size > 1} /></p>
          {price.compareAtMinor && product.saleEndsAt && <p className="text-sm text-muted-foreground">Sale ends {product.saleEndsAt.toLocaleDateString("en-NG", { dateStyle: "long", timeZone: "Africa/Lagos" })}.</p>}
          <div className="flex flex-wrap gap-2">
            {stock > 0 ? <Badge tone="success">In stock</Badge> : <Badge tone="danger">Sold out</Badge>}
            {showPv && <Badge tone="primary">{price.pv} PV</Badge>}
          </div>
        </div>
        <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
        {product.shippable ? (
          <p className="flex gap-2 rounded-md bg-muted p-3 text-sm"><Truck className="h-4 w-4 shrink-0 text-primary" aria-hidden /> {shop.deliveryInfo} {shop.freeShippingOverMinor > 0 && `Free delivery on orders over ${formatMoney(shop.freeShippingOverMinor, brand.currency)}.`}</p>
        ) : (
          <p className="flex gap-2 rounded-md bg-muted p-3 text-sm"><PackageX className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> This product can't be delivered at the moment.</p>
        )}
        {product.shippable && (
          <AddToCart productId={product.id} max={Math.min(product.stock, 99)} returnTo={`/products/${product.slug}`} variants={variants.length ? variants : undefined} currency={brand.currency} />
        )}
        {(attributes.length > 0 || size || product.weightGrams > 0) && (
          <section aria-labelledby="details-h" className="space-y-2">
            <h2 id="details-h" className="font-semibold">Details</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              {attributes.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}
              {product.weightGrams > 0 && <><dt className="text-muted-foreground">Weight</dt><dd>{product.weightGrams >= 1000 ? `${(product.weightGrams / 1000).toLocaleString("en-NG", { maximumFractionDigits: 2 })} kg` : `${product.weightGrams} g`}</dd></>}
              {size && <><dt className="text-muted-foreground">Package size</dt><dd>{size}</dd></>}
            </dl>
          </section>
        )}
        {showPv && (
          <p className="text-sm text-muted-foreground">
            Your share link: <code className="break-all rounded bg-muted px-1.5 py-0.5">{`${process.env.APP_URL}/r/${user.referralCode}?to=/products/${product.slug}`}</code>
          </p>
        )}
      </div>
    </div>
  );
}
