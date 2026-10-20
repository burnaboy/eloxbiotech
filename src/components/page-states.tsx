"use client";

import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Placeholder blocks shown while a page's server queries run. */
export function PageSkeleton({ blocks = 6 }: { blocks?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: blocks }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/** Shown when a page fails to load. No internal error details reach the browser. */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="space-y-4">
      <Alert tone="error">
        We couldn&apos;t load this page. Your balances and orders are safe; nothing was changed.
        {error.digest && <span className="block text-xs opacity-80">Reference: {error.digest}</span>}
      </Alert>
      <Button onClick={reset} variant="outline">Try again</Button>
    </div>
  );
}
