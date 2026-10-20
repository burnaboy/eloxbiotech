import { NextResponse } from "next/server";
import { readLocal } from "@/lib/storage";

/** Serves locally stored uploads (development, or a single server with a persistent disk). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const name = key.join("/");
  if (!name.endsWith(".webp")) return new NextResponse("Not found", { status: 404 });
  const body = await readLocal(name);
  if (!body) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
