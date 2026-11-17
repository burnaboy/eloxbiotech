import Link from "next/link";
import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { walletBalance } from "@/lib/wallet";
import { subWallets } from "@/lib/wallets";
import { LEDGER_LABEL, availableEffect } from "@/lib/ledger";
import { Stat } from "@/components/stat";
import { Button } from "@/components/ui/button";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "My E-wallets" };

export default async function WalletsPage() {
  const user = await requireAffiliate();
  const [brand, wallet, wallets, entries] = await Promise.all([
    getBrand(),
    walletBalance(user.id),
    subWallets(user.id),
    prisma.ledgerEntry.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const waiting = (w: { pendingMinor: number; heldMinor: number }) =>
    [w.pendingMinor ? `${m(w.pendingMinor)} pending` : "", w.heldMinor ? `${m(w.heldMinor)} held` : ""].filter(Boolean).join(", ");
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My E-wallets</h1>
        <Button asChild><Link href="/dashboard/payouts">Withdraw</Link></Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Wallet balance" value={m(wallet.availableMinor)} hint="Available to withdraw" />
        <Stat label="Unilevel wallet" value={m(wallets.unilevel.earnedMinor)} hint={`Direct commissions from your referral sales${waiting(wallets.unilevel) ? `, plus ${waiting(wallets.unilevel)}` : ""}`} />
        <Stat label="Bonus wallet" value={m(wallets.bonus.earnedMinor)} hint={`Binary pairing bonuses${waiting(wallets.bonus) ? `, plus ${waiting(wallets.bonus)}` : ""}`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending" value={m(wallet.pendingMinor)} hint="Waiting for the refund window" />
        <Stat label="Held" value={m(wallet.heldMinor)} hint="Disputed or under review" />
        <Stat label="Withdrawal in progress" value={m(wallet.reservedMinor)} hint="Set aside for a withdrawal" />
        <Stat label="Withdrawn" value={m(wallet.paidOutMinor)} hint="Paid to your bank" />
      </div>
      <p className="text-xs text-muted-foreground">The Unilevel and Bonus wallets show what each kind of commission has earned you after reversals. Both add up into your wallet balance, which is what you withdraw from.</p>
      <h2 className="text-lg font-semibold">Wallet activity</h2>
      {entries.length === 0 ? <Empty>No wallet activity yet.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>What happened</Th><Th>Note</Th><Th className="text-right">Effect on balance</Th></tr></THead>
          <TBody>
            {entries.map((e) => {
              const eff = availableEffect(e);
              return (
                <tr key={e.id}>
                  <Td>{formatDate(e.createdAt)}</Td>
                  <Td>{LEDGER_LABEL[e.type]} <span className="text-muted-foreground">({m(e.amountMinor)})</span></Td>
                  <Td className="text-muted-foreground">{e.memo ?? ""}</Td>
                  <Td className={`text-right tabular-nums ${eff < 0 ? "text-destructive" : eff > 0 ? "text-success" : "text-muted-foreground"}`}>{eff === 0 ? "—" : `${eff > 0 ? "+" : "−"}${m(Math.abs(eff))}`}</Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
