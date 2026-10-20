import Link from "next/link";
import { LayoutDashboard, LogOut, Shield, ShoppingBag, ShoppingCart, User } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getBrand } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";

export async function SiteHeader() {
  const [brand, user] = await Promise.all([getBrand(), getCurrentUser()]);
  const cartCount = user ? (await prisma.cartItem.aggregate({ where: { userId: user.id }, _sum: { quantity: true } }))._sum.quantity ?? 0 : 0;
  return (
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
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Shop</Link>
          </Button>
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">Orders</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard"><LayoutDashboard aria-hidden /> <span className="hidden sm:inline">Dashboard</span></Link>
              </Button>
              {user.role === "ADMIN" && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/admin"><Shield aria-hidden /> <span className="hidden sm:inline">Admin</span></Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/cart" aria-label={`Cart, ${cartCount} items`}>
                  <ShoppingCart aria-hidden /> {cartCount}
                </Link>
              </Button>
              <form action={logoutAction}>
                <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
                  <LogOut aria-hidden />
                </Button>
              </form>
            </>
          ) : (
            <>
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
  );
}
