import { paystackSecretKey } from "../payments/keys";
import { GatewayError } from "../payments/types";

/*
 * Bank list and account-name lookup for payout accounts. PAYOUT_VERIFICATION picks the source:
 *   paystack  Paystack's bank list and account resolve endpoints (read-only; no money moves). Test key outside production.
 *   test      a fixed list and a simulated lookup, for development and automated tests
 *   manual    no automatic check: staff confirm the account details when they review the first withdrawal
 * Sending money through a provider (transfers) is deliberately not wired up until that workflow is approved.
 */

export interface Bank {
  code: string;
  name: string;
}

export interface BankDirectory {
  name: "paystack" | "test" | "manual";
  listBanks(): Promise<Bank[]>;
  /** The account holder's name, or throws GatewayError(definite) if the account doesn't exist. Null = can't check. */
  resolveAccount(bankCode: string, accountNumber: string): Promise<string | null>;
}

// Commonly used Nigerian banks with their CBN/NIBSS codes, for test and manual modes.
const COMMON_BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank Nigeria" },
  { code: "050", name: "Ecobank Nigeria" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "214", name: "First City Monument Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "030", name: "Heritage Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "50515", name: "Moniepoint MFB" },
  { code: "999992", name: "OPay" },
  { code: "999991", name: "PalmPay" },
  { code: "076", name: "Polaris Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "068", name: "Standard Chartered Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "032", name: "Union Bank of Nigeria" },
  { code: "033", name: "United Bank for Africa" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
];

const testDirectory: BankDirectory = {
  name: "test",
  async listBanks() {
    return COMMON_BANKS;
  },
  async resolveAccount(_bank, account) {
    // 0000000000 simulates "account not found"; anything else resolves to a predictable name.
    if (account === "0000000000") throw new GatewayError("Could not resolve account name. Check the details and try again.", true);
    return `TEST ACCOUNT ${account.slice(-4)}`;
  },
};

const manualDirectory: BankDirectory = {
  name: "manual",
  async listBanks() {
    return COMMON_BANKS;
  },
  async resolveAccount() {
    return null;
  },
};

const paystackKey = () => paystackSecretKey();

async function paystackGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.paystack.co${path}`, { headers: { Authorization: `Bearer ${paystackKey()}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GatewayError("Couldn't reach the bank lookup service. Please try again.", false);
  }
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (res.status >= 500 || res.status === 429) throw new GatewayError("The bank lookup service is busy. Please try again shortly.", false);
  if (!res.ok || !body.status) throw new GatewayError(body.message ?? "Could not verify the account.", true);
  return body.data as T;
}

let bankCache: { at: number; banks: Bank[] } | null = null;

const paystackDirectory: BankDirectory = {
  name: "paystack",
  async listBanks() {
    if (bankCache && Date.now() - bankCache.at < 6 * 3600e3) return bankCache.banks;
    try {
      const rows = await paystackGet<{ name: string; code: string; active: boolean; currency: string }[]>("/bank?country=nigeria&currency=NGN&perPage=200");
      const banks = rows.filter((b) => b.active !== false).map((b) => ({ code: b.code, name: b.name })).sort((a, b) => a.name.localeCompare(b.name));
      bankCache = { at: Date.now(), banks };
      return banks;
    } catch {
      return COMMON_BANKS;
    }
  },
  async resolveAccount(bankCode, account) {
    const d = await paystackGet<{ account_name: string; account_number: string }>(`/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bankCode)}`);
    if (d.account_number && d.account_number !== account) throw new GatewayError("The bank returned a different account.", true);
    return d.account_name;
  },
};

export function bankDirectory(): BankDirectory {
  const mode = process.env.PAYOUT_VERIFICATION ?? (process.env.PAYMENT_PROVIDER === "paystack" ? "paystack" : "test");
  if (mode === "paystack") return paystackDirectory;
  if (mode === "manual") return manualDirectory;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PAYMENTS !== "true") return manualDirectory;
  return testDirectory;
}
