import { Alert } from "@/components/ui/alert";

export function Flash({ sp }: { sp: { ok?: string; error?: string } }) {
  if (sp.error) return <Alert tone="error">{sp.error}</Alert>;
  if (sp.ok) return <Alert tone="success">{sp.ok}</Alert>;
  return null;
}
