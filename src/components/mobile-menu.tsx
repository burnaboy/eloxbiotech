"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/** Small-screen navigation: a menu button that opens a list of links. Closes on Escape, on navigation and on outside click. */
export function MobileMenu({ links, children }: { links: { href: string; label: string }[]; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return (
    <div ref={box} className="relative md:hidden">
      <button ref={button} type="button" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-muted">
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        <span className="sr-only">Menu</span>
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="Menu" className="absolute right-0 top-12 z-50 w-56 rounded-lg border bg-card p-2 shadow-lg">
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={path === l.href ? "page" : undefined} className="block rounded-md px-3 py-2 text-sm hover:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-primary">{l.label}</Link>
              </li>
            ))}
          </ul>
          {children && <div className="mt-1 border-t pt-1">{children}</div>}
        </nav>
      )}
    </div>
  );
}
