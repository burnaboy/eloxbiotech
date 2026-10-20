import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  if (await getCurrentUser()) redirect(next ?? "/");
  return (
    <div className="container flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Welcome back.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reset && <p className="rounded-md bg-success/10 p-3 text-sm text-success">Password changed. Please sign in.</p>}
          <LoginForm next={next} />
          <p className="text-center text-sm"><Link href="/forgot-password" className="text-primary underline">Forgot your password?</Link></p>
          <p className="text-center text-sm text-muted-foreground">
            New here? <Link href="/register" className="text-primary underline">Create an account</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
