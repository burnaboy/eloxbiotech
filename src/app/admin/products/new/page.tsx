import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/components/admin/product-form";

export default async function NewProduct() {
  await requireAdmin("PRODUCTS");
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <Card>
      <CardHeader><CardTitle>New product</CardTitle></CardHeader>
      <CardContent><ProductForm categories={categories} /></CardContent>
    </Card>
  );
}
