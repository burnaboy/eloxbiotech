import type { AdminPermission } from "@prisma/client";
import { requireAdmin, canAccess } from "@/lib/session";
import { SideNav } from "@/components/side-nav";

const NAV: { href: string; label: string; perm?: AdminPermission; superOnly?: boolean }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders", perm: "ORDERS" },
  { href: "/admin/returns", label: "Returns", perm: "ORDERS" },
  { href: "/admin/products", label: "Products & stock", perm: "PRODUCTS" },
  { href: "/admin/categories", label: "Categories", perm: "PRODUCTS" },
  { href: "/admin/testimonials", label: "Testimonials", perm: "PRODUCTS" },
  { href: "/admin/users", label: "Members", perm: "MEMBERS" },
  { href: "/admin/network", label: "Network", perm: "NETWORK" },
  { href: "/admin/commissions", label: "Commissions", perm: "COMMISSIONS" },
  { href: "/admin/payouts", label: "Payouts", perm: "PAYOUTS" },
  { href: "/admin/support", label: "Support", perm: "SUPPORT" },
  { href: "/admin/risk", label: "Risk & reconciliation", perm: "RISK" },
  { href: "/admin/settings", label: "Settings", perm: "SETTINGS" },
  { href: "/admin/audit", label: "Audit log", perm: "AUDIT" },
  { href: "/admin/team", label: "Admin team", superOnly: true },
  { href: "/admin/operations", label: "Emergency operations", superOnly: true },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const items = NAV.filter((n) => (n.superOnly ? user.role === "SUPER_ADMIN" : !n.perm || canAccess(user, n.perm)));
  return (
    <div className="container grid gap-8 py-8 md:grid-cols-[210px_1fr]">
      <aside>
        <p className="mb-2 hidden px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground md:block">
          {user.role === "SUPER_ADMIN" ? "Super admin" : "Admin"}
        </p>
        <SideNav items={items} />
      </aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
