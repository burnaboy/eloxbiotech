import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { prisma } from "./db";
import { AppError } from "./errors";
import { getStorage } from "./storage";
import { audit } from "./audit";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 12;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2000;

/** Checks the file's own bytes, not its name or the browser's claimed type. */
function sniff(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/**
 * Validates and re-encodes an uploaded image: JPEG, PNG or WebP only, at most 5 MB, decoded and re-encoded
 * to WebP (max 2000 px). Re-encoding drops EXIF data such as GPS location and anything hidden in the file.
 */
export async function processImage(input: Buffer) {
  if (input.length === 0) throw new AppError("The file is empty.");
  if (input.length > MAX_IMAGE_BYTES) throw new AppError("Images must be 5 MB or smaller.");
  if (!sniff(input)) throw new AppError("Upload a JPEG, PNG or WebP image.");
  try {
    const img = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();
    const out = await img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return { body: out.data, width: out.info.width, height: out.info.height };
  } catch {
    throw new AppError("That image couldn't be read. Try exporting it again as JPEG or PNG.");
  }
}

export async function addProductImage(productId: string, file: File, alt: string, actorId: string) {
  const count = await prisma.productImage.count({ where: { productId } });
  if (count >= MAX_IMAGES_PER_PRODUCT) throw new AppError(`A product can have up to ${MAX_IMAGES_PER_PRODUCT} images.`);
  if (file.size > MAX_IMAGE_BYTES) throw new AppError("Images must be 5 MB or smaller.");
  const { body, width, height } = await processImage(Buffer.from(await file.arrayBuffer()));
  const key = `products/${productId.toLowerCase()}/${randomBytes(12).toString("hex")}.webp`;
  const url = await getStorage().put(key, body, "image/webp");
  try {
    const img = await prisma.productImage.create({
      data: { productId, storageKey: key, url, alt: alt.trim().slice(0, 200), width, height, bytes: body.length, sortOrder: count },
    });
    await audit("product.imageAdd", "Product", productId, actorId, { imageId: img.id, bytes: body.length });
    return img;
  } catch (e) {
    await getStorage().remove(key).catch(() => undefined);
    throw e;
  }
}

export async function removeProductImage(imageId: string, actorId: string) {
  const img = await prisma.productImage.delete({ where: { id: imageId } });
  if (!img.storageKey.startsWith("external:")) await getStorage().remove(img.storageKey).catch((e) => console.error("storage delete failed", e));
  await audit("product.imageRemove", "Product", img.productId, actorId, { imageId, key: img.storageKey });
  return img;
}

/** Moves an image one place earlier or later in the gallery. The first image is the main one. */
export async function moveProductImage(imageId: string, dir: -1 | 1) {
  await prisma.$transaction(async (tx) => {
    const img = await tx.productImage.findUniqueOrThrow({ where: { id: imageId } });
    const all = await tx.productImage.findMany({ where: { productId: img.productId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const i = all.findIndex((x) => x.id === imageId);
    const j = i + dir;
    if (j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    for (let k = 0; k < all.length; k++) if (all[k].sortOrder !== k) await tx.productImage.update({ where: { id: all[k].id }, data: { sortOrder: k } });
  });
}
