import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/*
 * Object storage for uploaded product images.
 *   STORAGE_DRIVER=local (default in development): files under UPLOAD_DIR, served by /media/[...key].
 *   STORAGE_DRIVER=s3: any S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2).
 *     S3_BUCKET, S3_REGION, S3_ENDPOINT (non-AWS), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *     S3_PUBLIC_URL: the public base URL images are served from (CDN or public bucket domain).
 * Only the server writes to storage, with credentials that never reach the browser. Keys are random and
 * server-generated; uploaders never choose file names or paths.
 */

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{0,200}\.(webp|jpg|png)$/;

export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid storage key");
  return key;
}

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR ?? ".data/uploads");
}

const local: Storage = {
  async put(key, body) {
    assertSafeKey(key);
    const file = path.join(uploadDir(), key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, { flag: "wx" });
    return `/media/${key}`;
  },
  async remove(key) {
    assertSafeKey(key);
    await unlink(path.join(uploadDir(), key)).catch(() => undefined);
  },
};

/** Reads a locally stored file for the /media route. Returns null for anything that isn't a safe, existing key. */
export async function readLocal(key: string) {
  try {
    assertSafeKey(key);
    const root = uploadDir();
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

function s3(): Storage {
  const bucket = process.env.S3_BUCKET;
  const publicUrl = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  if (!bucket || !publicUrl) throw new Error("S3_BUCKET and S3_PUBLIC_URL must be set when STORAGE_DRIVER=s3");
  const client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" }
      : undefined,
  });
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body, ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
        // Objects are only ever images we re-encoded ourselves.
        ContentDisposition: "inline",
      }));
      return `${publicUrl}/${key}`;
    },
    async remove(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

let cached: Storage | null = null;
export function getStorage(): Storage {
  if (cached) return cached;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") cached = s3();
  else if (driver === "local") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "true") {
      throw new Error("Local file storage isn't durable on managed hosting. Set STORAGE_DRIVER=s3 (or ALLOW_LOCAL_STORAGE=true for a single server with a persistent disk).");
    }
    cached = local;
  } else throw new Error(`Unknown STORAGE_DRIVER ${driver}`);
  return cached;
}
