import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBrand, getShopSettings } from "@/lib/settings";
import { Truck } from "lucide-react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { ProductImage } from "@/components/product-card";
import { AddToCart } from "@/components/add-to-cart";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await prisma.product.findUnique({ where: { slug: (await params).slug } });
  return { title: p?.name ?? "Product" };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, brand, user, shop] = await Promise.all([prisma.product.findUnique({ where: { slug }, include: { category: true } }), getBrand(), getCurrentUser(), getShopSettings()]);
  if (!product || !product.active) notFound();
  const showPv = user && user.role !== "CUSTOMER";
  return (
    <div className="container grid gap-10 py-10 md:grid-cols-2">
      <div className="space-y-3">
        <ProductImage product={product} className="rounded-lg border" />
        {product.images.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {product.images.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={`${product.name} gallery image`} className="aspect-square w-full rounded-md border object-cover" loading="lazy" />
            ))}
          </div>
        )}
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {product.category && <><Link href={`/?category=${product.category.slug}#products`} className="hover:underline">{product.category.name}</Link> · </>}SKU {product.sku}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-2xl font-semibold">{formatMoney(product.priceMinor, brand.currency)}</p>
          <div className="flex gap-2">
            {product.stock > 0 ? <Badge tone="success">In stock</Badge> : <Badge tone="danger">Sold out</Badge>}
            {showPv && <Badge tone="primary">{product.pv} PV</Badge>}
          </div>
        </div>
        <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
        <p className="flex gap-2 rounded-md bg-muted p-3 text-sm"><Truck className="h-4 w-4 shrink-0 text-primary" aria-hidden /> {shop.deliveryInfo} {shop.freeShippingOverMinor > 0 && `Free delivery on orders over ${formatMoney(shop.freeShippingOverMinor, brand.currency)}.`}</p>
        <AddToCart productId={product.id} max={Math.min(product.stock, 99)} returnTo={`/products/${product.slug}`} />
        {showPv && (
          <p className="text-sm text-muted-foreground">
            Your share link: <code className="rounded bg-muted px-1.5 py-0.5">{`${process.env.APP_URL}/r/${user.referralCode}?to=/products/${product.slug}`}</code>
          </p>
        )}
      </div>
    </div>
  );
}
