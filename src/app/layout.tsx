import type { Metadata } from "next";
import "./globals.css";
import { getBrand } from "@/lib/settings";
import { hexToRgbTriplet } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";

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
        <main id="main" className="min-h-[70vh]">{children}</main>
        <footer className="mt-16 border-t py-8 text-sm text-muted-foreground">
          <div className="container flex flex-col gap-2 sm:flex-row sm:justify-between">
            <p>© {new Date().getFullYear()} {brand.companyName}. {brand.tagline}</p>
            <nav className="flex gap-4" aria-label="Footer">
              <a href="/compensation" className="hover:text-foreground">Compensation plan</a>
              {brand.supportEmail && <a href={`mailto:${brand.supportEmail}`} className="hover:text-foreground">Support</a>}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
