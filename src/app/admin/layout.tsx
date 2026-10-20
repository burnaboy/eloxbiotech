import { requireAdmin } from "@/lib/session";
import { SideNav } from "@/components/side-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="container grid gap-8 py-8 md:grid-cols-[200px_1fr]">
      <aside>
        <p className="mb-2 hidden px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground md:block">Admin</p>
        <SideNav
          items={[
            { href: "/admin", label: "Overview" },
            { href: "/admin/orders", label: "Orders" },
            { href: "/admin/products", label: "Products & stock" },
            { href: "/admin/users", label: "Members" },
            { href: "/admin/network", label: "Network" },
            { href: "/admin/commissions", label: "Commissions" },
            { href: "/admin/payouts", label: "Payouts" },
            { href: "/admin/settings", label: "Settings" },
            { href: "/admin/audit", label: "Audit log" },
          ]}
        />
      </aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
