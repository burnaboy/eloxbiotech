import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string; leg?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  const jar = await cookies();
  const code = (sp.ref ?? jar.get("ref")?.value ?? "").toUpperCase().slice(0, 20) || undefined;
  const leg = sp.leg ?? jar.get("ref_leg")?.value;
  const sponsor = code ? await prisma.user.findUnique({ where: { referralCode: code }, select: { name: true, status: true } }) : null;
  return (
    <div className="container flex justify-center py-12">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Shop genuine products, and optionally earn by sharing them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RegisterForm referralCode={code} leg={leg === "LEFT" || leg === "RIGHT" ? leg : undefined} sponsorName={sponsor?.status === "ACTIVE" ? sponsor.name : undefined} />
          <p className="text-center text-sm text-muted-foreground">
            Already have an account? <Link href="/login" className="text-primary underline">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
