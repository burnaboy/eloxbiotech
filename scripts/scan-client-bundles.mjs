#!/usr/bin/env node
// Checks a finished production build (`npm run build`) for anything secret that a browser could download.
//
//   node scripts/scan-client-bundles.mjs [canary values...]
//
// What it reads: every file under .next/static (the JavaScript, CSS and media served to browsers) and every
// page Next pre-rendered at build time (.next/server/app and .next/server/pages: HTML and RSC payloads are
// sent to browsers as-is). It fails when it finds:
//   - a browser source map (*.map), which would publish the original source code;
//   - any canary value passed on the command line (run the build with throwaway secret values first);
//   - key shapes: Paystack keys, AWS access keys, private keys, database URLs with a password, JWTs, GitHub tokens;
//   - the names of server-only settings or server-only database fields.
// Exits 0 when clean, 1 with a list of hits otherwise.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const next = path.join(root, ".next");
if (!existsSync(path.join(next, "BUILD_ID"))) {
  console.error("No production build found: run `npm run build` first.");
  process.exit(1);
}

const canaries = process.argv.slice(2).filter((c) => c.length >= 8);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const rules = [
  ...canaries.map((c) => ({ name: "canary secret value", re: new RegExp(escape(c)) })),
  { name: "Paystack secret key", re: /sk_(live|test)_[A-Za-z0-9]{8,}/ },
  { name: "AWS access key id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "database URL", re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s"'`]+/ },
  { name: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/ },
  { name: "Slack token or webhook", re: /xox[abprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\// },
  {
    name: "server-only setting name",
    re: /\b(DATABASE_URL|SHADOW_DATABASE_URL|PAYSTACK_SECRET_KEY|APP_ENCRYPTION_KEY|CRON_SECRET|MONITOR_TOKEN|TEST_PAYMENT_SECRET|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|ERROR_ALERT_WEBHOOK|SEED_ADMIN_PASSWORD)\b/,
  },
  { name: "server-only database field", re: /\b(passwordHash|mfaSecretEnc|accountNumberEnc|costPriceMinor|tokenHash)\b/ },
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const browserFiles = [...walk(path.join(next, "static"))];
// Pre-rendered output only: the server's own code under .next/server never leaves the server.
const prerendered = [path.join(next, "server", "app"), path.join(next, "server", "pages")]
  .flatMap((d) => [...walk(d)])
  .filter((p) => /\.(html|rsc|body)$/.test(p));

const hits = [];
for (const f of browserFiles) if (f.endsWith(".map")) hits.push({ file: f, rule: "browser source map" });

let bytes = 0;
for (const f of [...browserFiles, ...prerendered]) {
  if (/\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot)$/i.test(f)) continue;
  const size = statSync(f).size;
  bytes += size;
  const text = readFileSync(f, "utf8");
  for (const r of rules) {
    const m = text.match(r.re);
    if (m) hits.push({ file: f, rule: r.name, sample: m[0].slice(0, 6) + "…" });
  }
}

const rel = (p) => path.relative(root, p);
if (hits.length) {
  console.error(`Found ${hits.length} problem(s) in files sent to browsers:`);
  for (const h of hits) console.error(`  ${rel(h.file)}: ${h.rule}${h.sample ? ` (${h.sample})` : ""}`);
  process.exit(1);
}
console.log(
  `scanned ${browserFiles.length} browser files and ${prerendered.length} pre-rendered pages ` +
    `(${(bytes / 1024 / 1024).toFixed(1)} MB, ${canaries.length} canary values): no source maps, secrets or server-only fields`,
);
