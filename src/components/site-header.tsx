import Link from "next/link";
import { Bell, CircleUser, LayoutDashboard, LogOut, Shield, ShoppingBag, ShoppingCart, User } from "lucide-react";
import { getOps } from "@/lib/settings";
import { getCurrentUser } from "@/lib/session";
import { getBrand } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";
import { MobileMenu } from "@/components/mobile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export async function SiteHeader() {
  const [brand, user] = await Promise.all([getBrand(), getCurrentUser()]);
  const cartCount = user ? (await prisma.cartItem.aggregate({ where: { userId: user.id }, _sum: { quantity: true } }))._sum.quantity ?? 0 : 0;
  const unread = user ? await prisma.notification.count({ where: { userId: user.id, readAt: null } }) : 0;
  const ops = await getOps();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
    {ops.notice && <div role="status" className="bg-accent px-4 py-2 text-center text-sm text-accent-foreground">{ops.notice}</div>}
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" className="h-8 w-8 rounded" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShoppingBag className="h-4 w-4" aria-hidden />
            </span>
          )}
          <span>{brand.companyName}</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1" aria-label="Main">
          <ThemeToggle initial={theme} />
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href="/products">Shop</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href="/about">About</Link>
          </Button>
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
                <Link href="/orders">Orders</Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
                <Link href="/dashboard"><LayoutDashboard aria-hidden /> Dashboard</Link>
              </Button>
              {(user.role === "ADMIN" || user.role === "SUPER_ADMIN") && (
                <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
                  <Link href="/admin"><Shield aria-hidden /> Admin</Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/cart" aria-label={`Cart, ${cartCount} items`}>
                  <ShoppingCart aria-hidden /> {cartCount}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon">
                <Link href="/notifications" aria-label={`Notifications, ${unread} unread`} className="relative">
                  <Bell aria-hidden />
                  {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex">
                <Link href="/account" aria-label="Account"><CircleUser aria-hidden /></Link>
              </Button>
              <form action={logoutAction} className="hidden md:block">
                <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
                  <LogOut aria-hidden />
                </Button>
              </form>
              <MobileMenu
                links={[
                  { href: "/products", label: "Shop" },
                  { href: "/about", label: "About" },
                  { href: "/orders", label: "My orders" },
                  { href: "/dashboard", label: "Dashboard" },
                  ...(user.role === "ADMIN" || user.role === "SUPER_ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
                  { href: "/account", label: "Account" },
                  { href: "/support", label: "Help and support" },
                ]}
              >
                <form action={logoutAction}><button className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted">Sign out</button></form>
              </MobileMenu>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="md:hidden">
                <Link href="/products">Shop</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login"><User aria-hidden /> Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Join</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
    </>
  );
}
