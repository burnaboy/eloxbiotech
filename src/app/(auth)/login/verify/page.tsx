import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Two-step verification" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.mfaPending) redirect(next ?? "/");
  return (
    <div className="container flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Two-step verification</CardTitle>
          <CardDescription>Signed in as {s.user.email}.</CardDescription>
        </CardHeader>
        <CardContent><VerifyForm next={next} /></CardContent>
      </Card>
    </div>
  );
}
