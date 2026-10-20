import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Pager } from "@/components/admin/pager";

const PER_PAGE = 50;

export default async function AdminProducts({ searchParams }: { searchParams: Promise<{ q?: string; low?: string; status?: string; category?: string; page?: string }> }) {
  await requireAdmin("PRODUCTS");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  // Low stock: at or under the alert level, for the product or any of its options.
  const lowIds = sp.low
    ? (await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "Product" p WHERE p.status <> 'ARCHIVED' AND (
          (NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v.active) AND p.stock <= p."lowStockThreshold")
          OR EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v.active AND v.stock <= COALESCE(v."lowStockThreshold", p."lowStockThreshold")))`).map((r) => r.id)
    : null;
  const where: Prisma.ProductWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q, mode: "insensitive" } } } }] } : {}),
    ...(sp.status && ["DRAFT", "ACTIVE", "ARCHIVED"].includes(sp.status) ? { status: sp.status as "DRAFT" } : {}),
    ...(sp.category ? { categoryId: sp.category } : {}),
    ...(lowIds ? { id: { in: lowIds } } : {}),
  };
  const [total, products, brand, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { category: true, variants: { where: { active: true }, select: { stock: true, lowStockThreshold: true } }, _count: { select: { images: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    getBrand(),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Products & stock</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/admin/categories">Categories</Link></Button>
          <Button asChild><Link href="/admin/products/new">Add product</Link></Button>
        </div>
      </div>
      <form className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Name or SKU" className="max-w-xs" aria-label="Search products" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-36">
          <option value="">Any status</option><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option>
        </Select>
        <Select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className="w-44">
          <option value="">Any category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={!!sp.low} className="h-4 w-4" /> Low stock only</label>
        <Button variant="outline">Filter</Button>
      </form>
      {products.length === 0 ? <Empty>No products.</Empty> : (
        <Table>
          <THead><tr><Th>Product</Th><Th>Category</Th><Th className="text-right">Price</Th><Th className="text-right">PV</Th><Th className="text-right">Stock</Th><Th>Status</Th></tr></THead>
          <TBody>
            {products.map((p) => {
              const stock = p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock;
              const low = p.variants.length ? p.variants.some((v) => v.stock <= (v.lowStockThreshold ?? p.lowStockThreshold)) : p.stock <= p.lowStockThreshold;
              return (
                <tr key={p.id}>
                  <Td><Link href={`/admin/products/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link><span className="block text-xs text-muted-foreground">{p.sku}{p.variants.length ? ` · ${p.variants.length} options` : ""}{p._count.images === 0 ? " · no images" : ""}</span></Td>
                  <Td>{p.category?.name ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{p.variants.length ? "from " : ""}{formatMoney(p.listPriceMinor, brand.currency)}</Td>
                  <Td className="text-right tabular-nums">{p.pv}</Td>
                  <Td className={`text-right tabular-nums ${low ? "font-semibold text-destructive" : ""}`}>{stock}</Td>
                  <Td className="space-x-1">
                    <Badge tone={p.status === "ACTIVE" ? "success" : p.status === "DRAFT" ? "warning" : "neutral"}>{p.status.toLowerCase()}</Badge>
                    {p.featured && <Badge tone="primary">featured</Badge>}
                    {!p.shippable && <Badge tone="danger">no delivery</Badge>}
                  </Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={page * PER_PAGE < total} params={sp} />
    </>
  );
}
