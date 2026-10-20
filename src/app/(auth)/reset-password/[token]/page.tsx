import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="container flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Choose a new password</CardTitle></CardHeader>
        <CardContent><ResetForm token={token} /></CardContent>
      </Card>
    </div>
  );
}
