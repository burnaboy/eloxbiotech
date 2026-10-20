import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { canSeeCosts, requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney, fromMinor } from "@/lib/money";
import { attributesToText, unitPrice } from "@/lib/catalog";
import { dateToLagosLocal, mmToCm } from "@/lib/product-input";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { ProductForm } from "@/components/admin/product-form";
import { ProductImage } from "@/components/product-card";
import { adjustStockAction, imageAction, saveVariantAction, uploadImageAction } from "../../actions";

const REASON: Record<string, string> = {
  RESTOCK: "restock", SALE: "order reserved", RELEASE: "order cancelled", REFUND: "refund (unshipped)",
  RETURN_RESTOCK: "return restocked", RETURN_WRITE_OFF: "return written off", ADJUSTMENT: "adjustment",
};

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const admin = await requireAdmin("PRODUCTS");
  const costs = canSeeCosts(admin);
  const { id } = await params;
  const [p, categories, moves, brand, reserved] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      omit: { costPriceMinor: !costs },
      include: {
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], omit: { costPriceMinor: !costs } },
      },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.inventoryMovement.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { variant: { select: { name: true } } } }),
    getBrand(),
    // Units held by orders waiting for payment, per line.
    prisma.orderItem.groupBy({ by: ["variantId"], where: { productId: id, order: { status: "PENDING_PAYMENT" } }, _sum: { quantity: true } }),
  ]);
  if (!p) notFound();
  const m = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(v, brand.currency));
  const heldFor = (variantId: string | null) => reserved.find((r) => r.variantId === variantId)?._sum.quantity ?? 0;
  const hasVariants = p.variants.length > 0;
  const price = unitPrice(p);
  const cost = (p as { costPriceMinor?: number | null }).costPriceMinor ?? null;
  const margin = costs && cost !== null && price.unitMinor > 0 ? Math.floor(((price.unitMinor - cost) * 1000) / price.unitMinor) / 10 : null;
  const stockLines = hasVariants ? p.variants.map((v) => ({ id: v.id as string | null, label: v.name, stock: v.stock, threshold: v.lowStockThreshold ?? p.lowStockThreshold })) : [{ id: null, label: "Product", stock: p.stock, threshold: p.lowStockThreshold }];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <Badge tone={p.status === "ACTIVE" ? "success" : p.status === "DRAFT" ? "warning" : "neutral"}>{p.status.toLowerCase()}</Badge>
          {!p.shippable && <Badge tone="danger">not deliverable</Badge>}
        </div>
        {p.status === "ACTIVE" && <Link href={`/products/${p.slug}`} className="text-sm text-primary underline">View in shop</Link>}
      </div>
      <Flash sp={await searchParams} />

      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Price now</p><p className="text-lg font-semibold">{m(price.unitMinor)}</p>{price.compareAtMinor && <p className="text-xs text-muted-foreground">on sale from {m(price.compareAtMinor)}</p>}</Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Available to sell</p><p className="text-lg font-semibold">{stockLines.reduce((s, l) => s + l.stock, 0)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Held by unpaid orders</p><p className="text-lg font-semibold">{reserved.reduce((s, r) => s + (r._sum.quantity ?? 0), 0)}</p><p className="text-xs text-muted-foreground">Released if payment doesn&apos;t arrive</p></Card>
        {costs && <Card className="p-4"><p className="text-xs text-muted-foreground">Cost / margin</p><p className="text-lg font-semibold">{m(cost)}</p><p className="text-xs text-muted-foreground">{margin === null ? "Set a cost price to see margin" : `${margin}% at current price`}</p></Card>}
      </div>

      <Card>
        <CardHeader><CardTitle>Stock</CardTitle><CardDescription>Every change is recorded with who made it and why. Stock can never go below zero.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <THead><tr><Th>{hasVariants ? "Option" : "Item"}</Th><Th className="text-right">Available</Th><Th className="text-right">Held (unpaid)</Th><Th className="text-right">Alert at</Th></tr></THead>
            <TBody>
              {stockLines.map((l) => (
                <tr key={l.id ?? "product"}>
                  <Td>{l.label}</Td>
                  <Td className={`text-right tabular-nums ${l.stock <= l.threshold ? "font-semibold text-destructive" : ""}`}>{l.stock}</Td>
                  <Td className="text-right tabular-nums">{heldFor(l.id)}</Td>
                  <Td className="text-right tabular-nums">{l.threshold}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
          <form action={adjustStockAction.bind(null, p.id)} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_150px_minmax(0,2fr)_auto]">
            {hasVariants ? (
              <Select name="variantId" aria-label="Option" required>{p.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
            ) : <input type="hidden" name="variantId" value="" />}
            <Input name="delta" inputMode="numeric" placeholder="+10 or -2" aria-label="Change" required />
            <Select name="reason" aria-label="Reason"><option value="RESTOCK">Restock</option><option value="ADJUSTMENT">Adjustment</option></Select>
            <Input name="note" placeholder="Note (supplier invoice, stock count, damage…)" aria-label="Note" required minLength={3} />
            <Button>Update stock</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
          <CardDescription>JPEG, PNG or WebP up to {MAX_IMAGE_BYTES / 1024 / 1024} MB. Images are checked, resized and re-saved without hidden data (such as GPS location). The first image is the main one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {p.images.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {p.images.map((img, i) => (
                <li key={img.id} className="space-y-1">
                  <ProductImage image={img} name={p.name} className="rounded-md border" />
                  <p className="line-clamp-1 text-xs text-muted-foreground">{img.alt || "No description"}</p>
                  <div className="flex gap-1">
                    <form action={imageAction.bind(null, p.id, img.id, "up")}><Button size="icon" variant="ghost" aria-label="Move earlier" disabled={i === 0}><ArrowUp /></Button></form>
                    <form action={imageAction.bind(null, p.id, img.id, "down")}><Button size="icon" variant="ghost" aria-label="Move later" disabled={i === p.images.length - 1}><ArrowDown /></Button></form>
                    <form action={imageAction.bind(null, p.id, img.id, "remove")}><Button size="icon" variant="ghost" aria-label="Remove image"><Trash2 /></Button></form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={uploadImageAction.bind(null, p.id)} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input type="file" name="file" accept="image/jpeg,image/png,image/webp" aria-label="Image file" required />
            <Input name="alt" placeholder="Describe the image for screen readers" aria-label="Image description" maxLength={200} />
            <Button>Upload</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Options</CardTitle>
          <CardDescription>Use options for sizes, colours or pack sizes. Each option has its own SKU and stock; empty price fields use the product&apos;s price. Turn an option off instead of deleting it so order history stays intact.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {p.variants.map((v) => (
            <VariantForm key={v.id} productId={p.id} costs={costs} v={{
              id: v.id, name: v.name, sku: v.sku, options: attributesToText(v.options).replace(/\n/g, ", "),
              price: v.priceMinor === null ? "" : fromMinor(v.priceMinor), salePrice: v.salePriceMinor === null ? "" : fromMinor(v.salePriceMinor),
              costPrice: costs && (v as { costPriceMinor?: number | null }).costPriceMinor != null ? fromMinor((v as { costPriceMinor: number }).costPriceMinor) : "",
              pv: v.pv?.toString() ?? "", weightGrams: v.weightGrams?.toString() ?? "", lowStockThreshold: v.lowStockThreshold?.toString() ?? "",
              sortOrder: String(v.sortOrder), active: v.active,
            }} />
          ))}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Add an option</summary>
            <div className="pt-3"><VariantForm productId={p.id} costs={costs} /></div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <ProductForm
            id={p.id}
            categories={categories}
            showCosts={costs}
            hasVariants={hasVariants}
            defaults={{
              name: p.name, slug: p.slug, sku: p.sku, description: p.description, categoryId: p.categoryId ?? "", status: p.status, featured: p.featured,
              price: fromMinor(p.priceMinor), salePrice: p.salePriceMinor === null ? "" : fromMinor(p.salePriceMinor),
              saleStartsAt: dateToLagosLocal(p.saleStartsAt), saleEndsAt: dateToLagosLocal(p.saleEndsAt),
              costPrice: cost === null ? "" : fromMinor(cost), pv: String(p.pv), lowStockThreshold: String(p.lowStockThreshold),
              shippable: p.shippable, weightGrams: p.weightGrams ? String(p.weightGrams) : "",
              lengthCm: mmToCm(p.lengthMm), widthCm: mmToCm(p.widthMm), heightCm: mmToCm(p.heightMm),
              metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "", attributes: attributesToText(p.attributes),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Stock history</CardTitle><CardDescription>Last 50 movements. Created {formatDate(p.createdAt)}, last updated {formatDate(p.updatedAt)}.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <THead><tr><Th>When</Th>{hasVariants && <Th>Option</Th>}<Th className="text-right">Change</Th><Th className="text-right">After</Th><Th>Reason</Th><Th>Note / order</Th></tr></THead>
            <TBody>
              {moves.map((mv) => (
                <tr key={mv.id}>
                  <Td>{formatDate(mv.createdAt)}</Td>
                  {hasVariants && <Td>{mv.variant?.name ?? "—"}</Td>}
                  <Td className={`text-right tabular-nums ${mv.delta < 0 ? "text-destructive" : "text-success"}`}>{mv.delta > 0 ? `+${mv.delta}` : mv.delta}</Td>
                  <Td className="text-right tabular-nums">{mv.balance ?? "—"}</Td>
                  <Td>{REASON[mv.reason] ?? mv.reason.toLowerCase()}</Td>
                  <Td>{mv.note ?? ""}{mv.orderId && <> <Link className="text-primary underline" href={`/admin/orders/${mv.orderId}`}>order</Link></>}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

type VariantValues = { id: string; name: string; sku: string; options: string; price: string; salePrice: string; costPrice: string; pv: string; weightGrams: string; lowStockThreshold: string; sortOrder: string; active: boolean };

function VariantForm({ productId, v, costs }: { productId: string; v?: VariantValues; costs: boolean }) {
  const k = v?.id ?? "new";
  const field = (name: keyof VariantValues | "initialStock", label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={`${k}-${name}`}>
      {label}
      <Input id={`${k}-${name}`} name={name} defaultValue={v ? String(v[name as keyof VariantValues] ?? "") : ""} {...props} />
    </label>
  );
  return (
    <form action={saveVariantAction.bind(null, productId, v?.id ?? null)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4 lg:grid-cols-8">
      {field("name", "Name", { required: true, placeholder: "500 ml" })}
      {field("sku", "SKU", { required: true })}
      <div className="sm:col-span-2">{field("options", "Attributes", { placeholder: "Size: 500 ml, Colour: Blue" })}</div>
      {field("price", "Price ₦", { inputMode: "decimal", placeholder: "product price" })}
      {field("salePrice", "Sale ₦", { inputMode: "decimal" })}
      {costs ? field("costPrice", "Cost ₦", { inputMode: "decimal" }) : <span />}
      {field("pv", "PV", { inputMode: "numeric", placeholder: "product PV" })}
      {field("weightGrams", "Weight g", { inputMode: "numeric" })}
      {field("lowStockThreshold", "Alert at", { inputMode: "numeric" })}
      {field("sortOrder", "Order", { inputMode: "numeric" })}
      {!v && field("initialStock", "Opening stock", { inputMode: "numeric" })}
      <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={v?.active ?? true} className="h-4 w-4" /> Available</label>
      <div className="flex items-end"><Button size="sm" variant={v ? "outline" : "default"}>{v ? "Save" : "Add option"}</Button></div>
    </form>
  );
}
