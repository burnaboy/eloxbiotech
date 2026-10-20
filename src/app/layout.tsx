import type { Metadata } from "next";
import "./globals.css";
import { getBrand } from "@/lib/settings";
import { hexToRgbTriplet } from "@/lib/utils";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/toast";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return { title: { default: brand.companyName, template: `%s · ${brand.companyName}` }, description: brand.tagline };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const style = { "--primary": hexToRgbTriplet(brand.primaryColor), "--accent": hexToRgbTriplet(brand.accentColor) } as React.CSSProperties;
  return (
    <html lang="en" style={style}>
      <body className="min-h-screen font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2">
          Skip to content
        </a>
        <SiteHeader />
        <Suspense fallback={null}><Toaster /></Suspense>
        <main id="main" className="min-h-[70vh]">{children}</main>
        <footer className="mt-16 border-t bg-muted/30 py-10 text-sm">
          <div className="container grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <p className="font-semibold">{brand.companyName}</p>
              <p className="text-muted-foreground">{brand.tagline}</p>
              {brand.registrationNumber && <p className="text-muted-foreground">Reg. no. {brand.registrationNumber}</p>}
            </div>
            {[
              { h: "Shop", l: [["All products", "/products"], ["Search", "/search"], ["Cart", "/cart"], ["Orders", "/orders"]] },
              { h: "Company", l: [["About us", "/about"], ["Contact", "/contact"], ["FAQ", "/faq"], ["Support", "/support"]] },
              { h: "Affiliates & policies", l: [["Affiliate programme", "/affiliate-programme"], ["Compensation plan", "/compensation"], ["Earnings disclaimer", "/legal/earnings-disclaimer"], ["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"], ["Shipping", "/legal/shipping"], ["Returns & refunds", "/legal/refunds"], ["Complaints", "/legal/complaints"]] },
            ].map((col) => (
              <nav key={col.h} aria-label={col.h} className="space-y-2">
                <p className="font-medium">{col.h}</p>
                <ul className="space-y-1">{col.l.map(([t, h]) => <li key={h}><a href={h} className="text-muted-foreground hover:text-foreground">{t}</a></li>)}</ul>
              </nav>
            ))}
          </div>
          <p className="container mt-8 text-xs text-muted-foreground">© {new Date().getFullYear()} {brand.companyName}. Payments processed securely by Paystack.</p>
        </footer>
      </body>
    </html>
  );
}
