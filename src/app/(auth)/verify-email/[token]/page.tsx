import Link from "next/link";
import { verifyEmail } from "@/lib/email-verification";
import { AppError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Confirm email" };

export default async function VerifyEmail({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let error: string | null = null;
  try {
    await verifyEmail(token);
  } catch (e) {
    error = e instanceof AppError ? e.message : "Something went wrong.";
  }
  return (
    <div className="container flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Email confirmation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {error ? <Alert tone="error">{error}</Alert> : <Alert tone="success">Thanks, your email is confirmed.</Alert>}
          <Button asChild><Link href="/account">Go to my account</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
