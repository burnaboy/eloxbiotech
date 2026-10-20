import Link from "next/link";
import { Package } from "lucide-react";
import type { Product, ProductImage as Img, ProductVariant } from "@prisma/client";
import { lowestPrice } from "@/lib/catalog";
import { Badge } from "@/components/ui/badge";
import { Price } from "@/components/price";

export function ProductImage({ image, name, className = "", eager }: { image?: Pick<Img, "url" | "alt" | "width" | "height"> | null; name: string; className?: string; eager?: boolean }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt={image.alt || name}
      width={image.width || undefined}
      height={image.height || undefined}
      className={`aspect-square w-full bg-muted object-cover ${className}`}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  ) : (
    <div className={`flex aspect-square w-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/20 ${className}`} aria-hidden>
      <Package className="h-12 w-12 text-primary/60" />
    </div>
  );
}

export type CardProduct = Product & {
  images: Pick<Img, "url" | "alt" | "width" | "height">[];
  variants: Pick<ProductVariant, "priceMinor" | "salePriceMinor" | "pv" | "stock" | "active">[];
};

/** Include this when loading products for cards. */
export const cardInclude = {
  images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, width: true, height: true } },
  variants: { where: { active: true }, select: { priceMinor: true, salePriceMinor: true, pv: true, stock: true, active: true } },
} as const;

export function ProductCard({ product, currency }: { product: CardProduct; currency: string }) {
  const price = lowestPrice(product, product.variants);
  const priced = product.variants.length > 1 && new Set(product.variants.map((v) => v.priceMinor ?? product.priceMinor)).size > 1;
  const stock = product.variants.length ? product.variants.reduce((s, v) => s + v.stock, 0) : product.stock;
  return (
    <Link href={`/products/${product.slug}`} className="group overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <ProductImage image={product.images[0]} name={product.name} className="transition-transform group-hover:scale-[1.02]" />
      <div className="space-y-1 p-4">
        <h3 className="line-clamp-1 font-medium">{product.name}</h3>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Price unitMinor={price.unitMinor} compareAtMinor={price.compareAtMinor} currency={currency} from={priced} />
          {stock <= 0 ? <Badge tone="danger">Sold out</Badge>
            : price.compareAtMinor ? <Badge tone="primary">Sale</Badge>
            : !product.variants.length && stock <= product.lowStockThreshold ? <Badge tone="warning">Only {stock} left</Badge> : null}
        </div>
      </div>
    </Link>
  );
}
