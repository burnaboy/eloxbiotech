import { ShieldCheck } from "lucide-react";
import { requireAdmin, STEP_UP_MINUTES } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "@/app/(auth)/login/verify/verify-form";

export const metadata = { title: "Confirm it's you" };

export default async function StepUp({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireAdmin();
  const { next } = await searchParams;
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Confirm it's you</CardTitle>
        <CardDescription>This action changes money or access. Enter a code from your authenticator app. You won't be asked again for {STEP_UP_MINUTES} minutes. Then submit the action again.</CardDescription>
      </CardHeader>
      <CardContent><VerifyForm next={next?.startsWith("/admin") ? next : "/admin"} submitLabel="Confirm" /></CardContent>
    </Card>
  );
}
