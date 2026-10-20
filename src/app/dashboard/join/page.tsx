import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JoinForm } from "./join-form";

export const metadata = { title: "Become an affiliate" };

export default async function JoinPage() {
  const user = await requireUser("/dashboard/join");
  if (user.role !== "CUSTOMER") redirect("/dashboard");
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Become an affiliate</CardTitle>
        <CardDescription>Free to join. No purchase or starter pack required. You earn only when products you share are bought and the order is complete.</CardDescription>
      </CardHeader>
      <CardContent><JoinForm /></CardContent>
    </Card>
  );
}
