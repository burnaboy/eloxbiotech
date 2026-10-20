"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={value} aria-label={label} className="h-9 flex-1 rounded-md border bg-muted px-3 text-sm" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />} <span className="sr-only sm:not-sr-only">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
    </div>
  );
}
