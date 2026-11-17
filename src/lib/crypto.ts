import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM for secrets at rest (MFA seeds). APP_ENCRYPTION_KEY is 32 random bytes, base64. */
function key() {
  const k = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string) {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
