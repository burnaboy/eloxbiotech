import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export default async function AdminProducts({ searchParams }: { searchParams: Promise<{ q?: string; low?: string }> }) {
  await requireAdmin("PRODUCTS");
  const sp = await searchParams;
  const [products, brand] = await Promise.all([
    prisma.product.findMany({
      where: sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { sku: { contains: sp.q, mode: "insensitive" } }] } : {},
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    getBrand(),
  ]);
  const list = sp.low ? products.filter((p) => p.stock <= p.lowStockThreshold) : products;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Products & stock</h1>
        <Button asChild><Link href="/admin/products/new">Add product</Link></Button>
      </div>
      <form className="flex gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Name or SKU" className="max-w-xs" aria-label="Search products" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={!!sp.low} className="h-4 w-4" /> Low stock only</label>
        <Button variant="outline">Filter</Button>
      </form>
      {list.length === 0 ? <Empty>No products.</Empty> : (
        <Table>
          <THead><tr><Th>Product</Th><Th>Category</Th><Th className="text-right">Price</Th><Th className="text-right">PV</Th><Th className="text-right">Stock</Th><Th>Status</Th></tr></THead>
          <TBody>
            {list.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/admin/products/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link><span className="block text-xs text-muted-foreground">{p.sku}</span></Td>
                <Td>{p.category?.name ?? "—"}</Td>
                <Td className="text-right tabular-nums">{formatMoney(p.priceMinor, brand.currency)}</Td>
                <Td className="text-right tabular-nums">{p.pv}</Td>
                <Td className={`text-right tabular-nums ${p.stock <= p.lowStockThreshold ? "font-semibold text-destructive" : ""}`}>{p.stock}</Td>
                <Td className="space-x-1">{p.active ? <Badge tone="success">live</Badge> : <Badge>hidden</Badge>}{p.featured && <Badge tone="primary">featured</Badge>}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
