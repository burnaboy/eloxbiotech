/*
 * Server error logging with secrets and personal data removed. Never pass request bodies, cookies or
 * headers here; pass the error and a short context string. Prisma errors can quote query values, so the
 * message is scrubbed too.
 */

const PATTERNS: [RegExp, string][] = [
  [/sk_(live|test)_[A-Za-z0-9]+/g, "sk_$1_[redacted]"],
  [/pk_(live|test)_[A-Za-z0-9]+/g, "pk_$1_[redacted]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\$argon2[a-z]*\$[^\s"']+/g, "[password hash]"],
  [/("?(password|passwordHash|token|tokenHash|secret|mfaSecretEnc|accountNumber|accountNumberEnc|cookie|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1[redacted]"],
  [/\b\d{10,19}\b/g, "[number]"], // bank account and card numbers
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function scrub(text: string) {
  return PATTERNS.reduce((s, [re, to]) => s.replace(re, to), text).slice(0, 4000);
}

export function logError(context: string, e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  const code = (e as { code?: string })?.code;
  console.error(`[error] ${context}${code ? ` (${code})` : ""}: ${scrub(err.message)}\n${scrub(err.stack?.split("\n").slice(1, 8).join("\n") ?? "")}`);
}
