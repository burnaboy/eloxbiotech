/*
 * Structured logging. In production each line is one JSON object ({time, level, event, ...fields}) for the
 * host's log store to index and alert on; in development it's a readable line. Everything written is
 * scrubbed of secrets and personal data. Never pass request bodies, cookies or headers here.
 */

const PATTERNS: [RegExp, string][] = [
  [/sk_(live|test)_[A-Za-z0-9]+/g, "sk_$1_[redacted]"],
  [/pk_(live|test)_[A-Za-z0-9]+/g, "pk_$1_[redacted]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\$argon2[a-z]*\$[^\s"'\\]+/g, "[password hash]"],
  [/(\\?"?(password|passwordHash|token|tokenHash|secret|mfaSecretEnc|accountNumber|accountNumberEnc|cookie|authorization)\\?"?\s*[:=]\s*)(\\?"[^"\\]*\\?"|'[^']*'|[^\s,}]+)/gi, "$1[redacted]"],
  [/postgres(ql)?:\/\/[^\s"'\\]+/gi, "[database url]"],
  [/\b\d{10,19}\b/g, "[number]"], // bank account and card numbers
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function scrub(text: string) {
  return PATTERNS.reduce((s, [re, to]) => s.replace(re, to), text).slice(0, 4000);
}

type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

const json = () => (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "text")) === "json";

/** Writes one log line. `event` is a short stable name to search and alert on, e.g. "cron.done". */
export function log(level: Level, event: string, fields: Fields = {}) {
  const write = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  if (json()) {
    write(scrub(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })));
  } else {
    const rest = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === "string" && v.includes("\n") ? `\n${v}` : v}`).join(" ");
    write(scrub(`[${level}] ${event}${rest ? ` ${rest}` : ""}`));
  }
}

/** Logs a caught error with a short context, and sends an alert if ERROR_ALERT_WEBHOOK is set. */
export function logError(context: string, e: unknown, fields: Fields = {}) {
  const err = e instanceof Error ? e : new Error(String(e));
  const code = (e as { code?: string })?.code;
  const stack = err.stack?.split("\n").slice(1, 8).map((l) => l.trim()).join("\n");
  log("error", "error", { context, code, error: err.name, message: err.message, stack, ...fields });
  void alert(context, `${err.name}: ${err.message}`);
}

// One alert per context per 5 minutes per instance, so an error storm doesn't flood the channel.
const lastAlert = new Map<string, number>();

async function alert(context: string, summary: string) {
  const url = process.env.ERROR_ALERT_WEBHOOK;
  if (!url) return;
  const now = Date.now();
  if (now - (lastAlert.get(context) ?? 0) < 5 * 60e3) return;
  lastAlert.set(context, now);
  try {
    const text = scrub(`[${process.env.APP_ENV ?? process.env.NODE_ENV}] ${context}: ${summary}`).slice(0, 500);
    // "text" suits Slack, Google Chat and most alerting tools; "content" suits Discord.
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(3000) });
  } catch {
    // Alerting must never break the request that hit the error.
  }
}
