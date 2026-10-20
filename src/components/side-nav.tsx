"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SideNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Section" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((i) => {
        const active = path === i.href || (i.href.split("/").length > 2 && path.startsWith(i.href));
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-muted", active && "bg-primary/10 font-medium text-primary")}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
