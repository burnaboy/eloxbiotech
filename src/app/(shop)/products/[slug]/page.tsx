import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
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
  const [product, brand, user] = await Promise.all([prisma.product.findUnique({ where: { slug } }), getBrand(), getCurrentUser()]);
  if (!product || !product.active) notFound();
  const showPv = user && user.role !== "CUSTOMER";
  return (
    <div className="container grid gap-10 py-10 md:grid-cols-2">
      <ProductImage product={product} className="rounded-lg border" />
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">SKU {product.sku}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-2xl font-semibold">{formatMoney(product.priceMinor, brand.currency)}</p>
          <div className="flex gap-2">
            {product.stock > 0 ? <Badge tone="success">In stock</Badge> : <Badge tone="danger">Sold out</Badge>}
            {showPv && <Badge tone="primary">{product.pv} PV</Badge>}
          </div>
        </div>
        <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
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
