import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProductListing, type ListingParams } from "@/components/product-listing";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await prisma.category.findUnique({ where: { slug: (await params).slug } });
  return { title: c?.name ?? "Category", description: c?.description ?? undefined };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ListingParams> }) {
  const { slug } = await params;
  const cat = await prisma.category.findUnique({ where: { slug } });
  if (!cat || !cat.active) notFound();
  const sp = await searchParams;
  return (
    <>
      <ProductListing sp={{ ...sp, category: slug }} basePath={`/category/${slug}`} title={cat.name} lockCategory />
    </>
  );
}
