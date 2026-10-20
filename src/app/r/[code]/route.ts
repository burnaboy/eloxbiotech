import { NextResponse, type NextRequest } from "next/server";

/** Referral link: /r/CODE?leg=LEFT&to=/products/x. Remembers the sponsor for 30 days. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  const dest = to && to.startsWith("/") && !to.startsWith("//") ? to : "/";
  const res = NextResponse.redirect(new URL(dest, process.env.APP_URL ?? req.url));
  const opts = { httpOnly: true, sameSite: "lax" as const, maxAge: 30 * 86400, path: "/", secure: process.env.NODE_ENV === "production" };
  res.cookies.set("ref", code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20), opts);
  const leg = url.searchParams.get("leg");
  if (leg === "LEFT" || leg === "RIGHT") res.cookies.set("ref_leg", leg, opts);
  return res;
}
