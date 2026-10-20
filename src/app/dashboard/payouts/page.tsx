import { randomBytes } from "node:crypto";
import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getShopSettings } from "@/lib/settings";
import { walletBalance } from "@/lib/wallet";
import { activeAccount, COOLING_OFF_HOURS, maskedAccount } from "@/lib/payouts/accounts";
import { bankDirectory } from "@/lib/payouts/banks";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Flash } from "@/components/flash";
import { Stat } from "@/components/stat";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { AccountForm, PayoutForm } from "./payout-form";
import { cancelPayoutAction, removeAccountAction } from "../actions";

export const metadata = { title: "Withdrawals" };

const STATUS_HELP: Record<string, string> = {
  REQUESTED: "Waiting for review",
  APPROVED: "Approved, will be sent in the next batch",
  PROCESSING: "Sent to your bank",
  PAID: "Paid",
  REJECTED: "Rejected, amount returned to your wallet",
  FAILED: "Transfer failed, amount returned to your wallet",
};

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireAffiliate();
  const [wallet, brand, shop, payouts, account, banks] = await Promise.all([
    walletBalance(user.id),
    getBrand(),
    getShopSettings(),
    prisma.payout.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    activeAccount(user.id),
    bankDirectory().listBanks(),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const open = payouts.find((p) => ["REQUESTED", "APPROVED", "PROCESSING"].includes(p.status));
  const coolingOff = account && account.usableFrom > new Date();
  const blocked = !account || !!coolingOff || !!open || wallet.availableMinor < shop.minPayoutMinor || !user.emailVerifiedAt;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Withdrawals</h1>
      <Flash sp={await searchParams} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Available to withdraw" value={m(wallet.availableMinor)} hint={`Minimum ${m(shop.minPayoutMinor)}`} />
        <Stat label="Being withdrawn" value={m(wallet.reservedMinor)} hint="Reserved for open requests" />
        <Stat label="Paid to you" value={m(wallet.paidOutMinor)} hint="Completed withdrawals" />
      </div>
      {wallet.availableMinor < 0 && <Alert tone="error">Your balance is below zero because a commission you had already withdrawn was reversed. It will be recovered from future earnings.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bank account</CardTitle>
            <CardDescription>Withdrawals are paid by bank transfer to an account in your name. We store only the bank, account number (encrypted) and account name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {account ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">{maskedAccount(account)}</p>
                <p className="text-muted-foreground">{account.verifiedAt ? "Account name confirmed with the bank." : "Our team will confirm this account before your first withdrawal."}</p>
                {coolingOff && <Alert>For your security, new bank details can receive withdrawals from {formatDate(account.usableFrom)} ({COOLING_OFF_HOURS} hours after they were added).</Alert>}
                {!open && <form action={removeAccountAction}><Button variant="ghost" size="sm">Remove account</Button></form>}
              </div>
            ) : (
              <Alert>Add your bank account to withdraw your earnings.</Alert>
            )}
            {!open && <AccountForm banks={banks} current={account?.bankCode} />}
            {open && <p className="text-sm text-muted-foreground">You can change your bank account when your current withdrawal is finished.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Request a withdrawal</CardTitle>
            <CardDescription>Requests are reviewed by our team, then sent by bank transfer. You'll get an email at each step.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {open && <Alert>You have a withdrawal in progress ({STATUS_HELP[open.status].toLowerCase()}).</Alert>}
            {!user.emailVerifiedAt && <Alert tone="error">Confirm your email address before withdrawing.</Alert>}
            {!open && wallet.availableMinor < shop.minPayoutMinor && <p className="text-sm text-muted-foreground">You can withdraw once your available balance reaches {m(shop.minPayoutMinor)}.</p>}
            <PayoutForm requestKey={randomBytes(18).toString("base64url")} disabled={blocked} />
          </CardContent>
        </Card>
      </div>
      <h2 className="text-lg font-semibold">History</h2>
      {payouts.length === 0 ? <Empty>No withdrawals yet. When you request one, it appears here with its progress.</Empty> : (
        <Table>
          <THead><tr><Th>Requested</Th><Th>To</Th><Th>Status</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
          <TBody>
            {payouts.map((p) => (
              <tr key={p.id}>
                <Td>{formatDate(p.createdAt)}</Td>
                <Td className="text-muted-foreground">{p.destination}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                  <span className="block text-xs text-muted-foreground">{STATUS_HELP[p.status]}{p.failureReason && p.failureReason !== "Cancelled by member" ? `: ${p.failureReason}` : ""}</span>
                </Td>
                <Td>{p.status === "PAID" ? p.reference : "—"}{p.settledAt && <span className="block text-xs text-muted-foreground">{formatDate(p.settledAt)}</span>}</Td>
                <Td className="text-right tabular-nums">{m(p.amountMinor)}</Td>
                <Td>{p.status === "REQUESTED" && <form action={cancelPayoutAction.bind(null, p.id)}><Button variant="ghost" size="sm">Cancel</Button></form>}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
