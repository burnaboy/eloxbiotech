import Link from "next/link";
import { Package } from "lucide-react";
import type { Product } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";

export function ProductImage({ product, className = "" }: { product: Pick<Product, "imageUrl" | "name">; className?: string }) {
  return product.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={product.imageUrl} alt={product.name} className={`aspect-square w-full object-cover ${className}`} loading="lazy" />
  ) : (
    <div className={`flex aspect-square w-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/20 ${className}`} aria-hidden>
      <Package className="h-12 w-12 text-primary/60" />
    </div>
  );
}

export function ProductCard({ product, currency }: { product: Product; currency: string }) {
  return (
    <Link href={`/products/${product.slug}`} className="group overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <ProductImage product={product} className="transition-transform group-hover:scale-[1.02]" />
      <div className="space-y-1 p-4">
        <h3 className="line-clamp-1 font-medium">{product.name}</h3>
        <div className="flex items-center justify-between">
          <span className="font-semibold">{formatMoney(product.priceMinor, currency)}</span>
          {product.stock <= 0 ? <Badge tone="danger">Sold out</Badge> : product.stock <= product.lowStockThreshold ? <Badge tone="warning">Only {product.stock} left</Badge> : null}
        </div>
      </div>
    </Link>
  );
}
