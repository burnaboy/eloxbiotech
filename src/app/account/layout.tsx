import { requireUser } from "@/lib/session";
import { SideNav } from "@/components/side-nav";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/account");
  return (
    <div className="container grid grid-cols-1 gap-8 py-8 md:grid-cols-[200px_1fr]">
      <aside className="min-w-0">
        <SideNav
          items={[
            { href: "/account", label: "Profile" },
            { href: "/account/addresses", label: "Addresses" },
            { href: "/account/security", label: "Security" },
            { href: "/orders", label: "Orders" },
            { href: "/notifications", label: "Notifications" },
            { href: "/support", label: "Support" },
          ]}
        />
      </aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
