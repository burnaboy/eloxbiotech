"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

/**
 * Success messages after a form action ("?ok=..."), shown as a toast that disappears after a few seconds.
 * Announced to screen readers, dismissible with the button or Escape. The message is removed from the
 * address bar so a reload doesn't show it again. Errors stay inline next to the form instead (see Flash).
 */
export function Toaster() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const ok = params.get("ok");

  useEffect(() => {
    if (!ok) return;
    setMessage(ok.slice(0, 300));
    const next = new URLSearchParams(params.toString());
    next.delete("ok");
    router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false });
  }, [ok, params, path, router]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMessage(null);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [message]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 sm:left-auto sm:right-6 sm:w-96">
      {message && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-success/30 bg-card p-4 text-sm shadow-lg">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p className="flex-1">{message}</p>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
