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
          { href: "/dashboard/commissions", label: "Commissions" },
          { href: "/dashboard/payouts", label: "Payouts" },
        ];
  return (
    <div className="container grid gap-8 py-8 md:grid-cols-[200px_1fr]">
      <aside><SideNav items={items} /></aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
