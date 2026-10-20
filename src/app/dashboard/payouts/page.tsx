import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getShopSettings } from "@/lib/settings";
import { walletBalance } from "@/lib/wallet";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { PayoutForm } from "./payout-form";

export const metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  const user = await requireAffiliate();
  const [wallet, brand, shop, payouts] = await Promise.all([
    walletBalance(user.id),
    getBrand(),
    getShopSettings(),
    prisma.payout.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
      <Card>
        <CardHeader>
          <CardTitle>Request a payout</CardTitle>
          <CardDescription>Available: <strong>{m(wallet.availableMinor)}</strong>. Minimum payout {m(shop.minPayoutMinor)}.</CardDescription>
        </CardHeader>
        <CardContent><PayoutForm availableMajor={wallet.availableMinor / 100} minMajor={shop.minPayoutMinor / 100} /></CardContent>
      </Card>
      {payouts.length === 0 ? <Empty>No payouts yet.</Empty> : (
        <Table>
          <THead><tr><Th>Requested</Th><Th>Method</Th><Th>Status</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></THead>
          <TBody>
            {payouts.map((p) => (
              <tr key={p.id}>
                <Td>{formatDate(p.createdAt)}</Td>
                <Td>{p.method.replace("_", " ").toLowerCase()}</Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td>{p.reference ?? "—"}</Td>
                <Td className="text-right tabular-nums">{m(p.amountMinor)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
