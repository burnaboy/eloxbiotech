import { requireUser } from "@/lib/session";
import { SideNav } from "@/components/side-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/dashboard");
  const items =
    user.role === "CUSTOMER"
      ? [{ href: "/dashboard", label: "Overview" }, { href: "/orders", label: "My orders" }]
      : [
          { href: "/dashboard", label: "Overview" },
          { href: "/dashboard/tree", label: "Binary tree" },
          { href: "/dashboard/team", label: "My referrals" },
          { href: "/products", label: "Buy product" },
          { href: "/orders", label: "Purchase history" },
          { href: "/dashboard/wallets", label: "My E-wallets" },
          { href: "/dashboard/pairing", label: "Pairing history" },
          { href: "/dashboard/rank-awards", label: "Rank awards" },
          { href: "/dashboard/payouts", label: "All withdrawals" },
          { href: "/dashboard/package-upgrade", label: "Package upgrade" },
          { href: "/support", label: "Need support" },
          { href: "/dashboard/stockists", label: "Stockist location" },
          { href: "/dashboard/sales", label: "Attributed sales" },
          { href: "/dashboard/commissions", label: "Commissions" },
        ];
  return (
    <div className="container grid grid-cols-1 gap-8 py-8 md:grid-cols-[200px_1fr]">
      <aside className="min-w-0"><SideNav items={items} /></aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
