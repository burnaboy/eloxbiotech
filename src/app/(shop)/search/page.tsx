import { ProductListing, type ListingParams } from "@/components/product-listing";

export const metadata = { title: "Search" };

export default async function Search({ searchParams }: { searchParams: Promise<ListingParams> }) {
  const sp = await searchParams;
  return <ProductListing sp={sp} basePath="/search" title={sp.q ? `Search results for "${sp.q.slice(0, 100)}"` : "Search"} />;
}
