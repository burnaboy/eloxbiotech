import { Alert } from "@/components/ui/alert";

/** Result of a form action. Errors show inline next to the form; successes appear as a toast (see Toaster in the root layout). */
export function Flash({ sp }: { sp: { ok?: string; error?: string } }) {
  if (sp.error) return <Alert tone="error">{sp.error}</Alert>;
  return null;
}
