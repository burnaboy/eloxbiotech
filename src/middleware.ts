import { NextResponse, type NextRequest } from "next/server";

/*
 * Content Security Policy with a fresh nonce per request. Next.js reads the nonce from the request's CSP
 * header and adds it to its own scripts, so only scripts we serve can run: injected markup can't execute.
 * Styles allow inline because the brand colours are set as CSS variables in a style attribute.
 * Payment pages are hosted by Paystack (a full-page redirect), so the only outside target is form-action
 * to Paystack's checkout, which a redirect after checkout submission needs.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.paystack.com",
    ...(process.env.APP_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Pages only: static files, images and API routes (webhooks, cron, health) don't need a page policy.
  matcher: [{ source: "/((?!api/|_next/static|_next/image|favicon.ico|media/).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
