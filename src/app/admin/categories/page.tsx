import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Flash } from "@/components/flash";
import { saveCategoryAction } from "../actions";

function CategoryFields({ c }: { c?: { name: string; slug: string; description: string | null; sortOrder: number; active: boolean } }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_80px_auto_auto] sm:items-center">
      <Input name="name" defaultValue={c?.name} placeholder="Name" aria-label="Name" required />
      <Input name="slug" defaultValue={c?.slug} placeholder="slug" aria-label="Slug" required pattern="[a-z0-9-]+" />
      <Input name="description" defaultValue={c?.description ?? ""} placeholder="Description" aria-label="Description" />
      <Input name="sortOrder" defaultValue={c?.sortOrder ?? 0} aria-label="Sort order" inputMode="numeric" />
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={c?.active ?? true} className="h-4 w-4" /> Live</label>
      <Button variant={c ? "outline" : "default"}>{c ? "Save" : "Add"}</Button>
    </div>
  );
}

export default async function Categories({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("PRODUCTS");
  const cats = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader><CardTitle>Add a category</CardTitle></CardHeader>
        <CardContent><form action={saveCategoryAction.bind(null, null)}><CategoryFields /></form></CardContent>
      </Card>
      <div className="space-y-2">
        {cats.map((c) => (
          <Card key={c.id} className="p-4">
            <p className="mb-2 text-xs text-muted-foreground">{c._count.products} product(s)</p>
            <form action={saveCategoryAction.bind(null, c.id)}><CategoryFields c={c} /></form>
          </Card>
        ))}
      </div>
    </>
  );
}
