import { ProductListing, type ListingParams } from "@/components/product-listing";

export const metadata = { title: "All products" };

export default async function Catalogue({ searchParams }: { searchParams: Promise<ListingParams> }) {
  return <ProductListing sp={await searchParams} basePath="/products" title="All products" />;
}
