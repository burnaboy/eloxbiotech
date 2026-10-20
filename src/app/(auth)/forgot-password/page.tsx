import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <div className="container flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Reset your password</CardTitle><CardDescription>Enter your account email and we'll send you a link.</CardDescription></CardHeader>
        <CardContent><ForgotForm /></CardContent>
      </Card>
    </div>
  );
}
