import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { ProductForm } from "@/components/admin/product-form";
import { adjustStockAction } from "../../actions";

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("PRODUCTS");
  const { id } = await params;
  const [p, categories, moves] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.inventoryMovement.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (!p) notFound();
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
        <Link href={`/products/${p.slug}`} className="text-sm text-primary underline">View in shop</Link>
      </div>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader><CardTitle>Stock: {p.stock}</CardTitle><CardDescription>Every change is recorded with who made it and why.</CardDescription></CardHeader>
        <CardContent>
          <form action={adjustStockAction.bind(null, p.id)} className="grid gap-2 sm:grid-cols-[120px_160px_1fr_auto]">
            <Input name="delta" inputMode="numeric" placeholder="+10 or -2" aria-label="Change" required />
            <Select name="reason" aria-label="Reason"><option value="RESTOCK">Restock</option><option value="ADJUSTMENT">Adjustment</option></Select>
            <Input name="note" placeholder="Note (e.g. supplier invoice, stock count)" aria-label="Note" required />
            <Button>Update stock</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <ProductForm
            id={p.id}
            categories={categories}
            defaults={{ name: p.name, slug: p.slug, sku: p.sku, description: p.description, price: p.priceMinor / 100, pv: p.pv, lowStockThreshold: p.lowStockThreshold, weightGrams: p.weightGrams, imageUrl: p.imageUrl ?? "", images: p.images.join("\n"), categoryId: p.categoryId ?? "", active: p.active, featured: p.featured }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Stock history</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><tr><Th>When</Th><Th>Change</Th><Th>Reason</Th><Th>Note / order</Th></tr></THead>
            <TBody>
              {moves.map((mv) => (
                <tr key={mv.id}>
                  <Td>{formatDate(mv.createdAt)}</Td>
                  <Td className={`tabular-nums ${mv.delta < 0 ? "text-destructive" : "text-success"}`}>{mv.delta > 0 ? `+${mv.delta}` : mv.delta}</Td>
                  <Td>{mv.reason.toLowerCase()}</Td>
                  <Td>{mv.note ?? (mv.orderId ? <Link className="text-primary underline" href={`/admin/orders/${mv.orderId}`}>order</Link> : "—")}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
