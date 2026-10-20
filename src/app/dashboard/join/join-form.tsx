"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { joinAction } from "../actions";

export function JoinForm() {
  const [leg, setLeg] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-1">
        <label htmlFor="leg" className="text-sm font-medium">Placement side</label>
        <Select id="leg" value={leg} onChange={(e) => setLeg(e.target.value)}>
          <option value="">Automatic</option>
          <option value="LEFT">Left</option>
          <option value="RIGHT">Right</option>
        </Select>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        I have read the <a href="/compensation" target="_blank" className="text-primary underline">compensation plan</a> and understand earnings depend on real product sales.
      </label>
      <Button disabled={!agree || pending} onClick={() => start(async () => setError((await joinAction(leg ? (leg as "LEFT" | "RIGHT") : null))?.error))}>
        {pending ? "Joining…" : "Become an affiliate"}
      </Button>
    </div>
  );
}
