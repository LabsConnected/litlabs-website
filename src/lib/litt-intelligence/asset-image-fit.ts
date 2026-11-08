import "server-only";

import { DEPLOYMENT_LIMITS } from "@/lib/deployments/user-deployment";

/**
 * Publish-safe image normalization.
 *
 * The workspace file API cannot read files larger than the terminal
 * server's MAX_READ_SIZE back, and the deployment artifact validator
 * rejects any file over DEPLOYMENT_LIMITS.maxFileBytes — an oversized
 * image writes fine but can never be collected for publish, where it
 * surfaces as a bogus "missing file" (golden run 42455260375:
 * index.html → assets/images/external-image-*.jpeg, a rehosted
 * full-resolution hotlink over the 2MB cap).
 *
 * Every image that enters a project workspace — agent tool inserts,
 * stock photos, generated assets, and the "use in project" route —
 * funnels through here so what is written is always publishable.
 * Oversized rasters are downscaled/re-encoded; payloads that cannot be
 * made to fit are refused honestly instead of shipping a file deploy
 * must later drop.
 */

/** Per-file deploy cap — identical to the terminal read cap boundary. */
export const PUBLISH_MAX_IMAGE_BYTES = DEPLOYMENT_LIMITS.maxFileBytes;

/** Web-appropriate upper bound; providers already target ~1600px. */
const PUBLISH_MAX_DIMENSION = 1920;

const RESIZABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export interface FittedImage {
  buffer: Buffer;
  contentType: string;
}

/**
 * Returns the payload unchanged when it already fits the publish cap.
 * Otherwise re-encodes it under the cap, or returns null when the image
 * cannot be made publishable (animated, undecodable, or still too large).
 */
export async function fitImageForPublish(
  buffer: Buffer,
  contentType: string,
): Promise<FittedImage | null> {
  if (buffer.length <= PUBLISH_MAX_IMAGE_BYTES) return { buffer, contentType };
  const mime = contentType.toLowerCase();
  if (!RESIZABLE_IMAGE_TYPES.has(mime)) return null;
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(buffer).metadata();
    // Animated images would be silently flattened to a still — refuse
    // rather than change what the caller asked for.
    if ((meta.pages ?? 1) > 1) return null;
    const pipeline = sharp(buffer)
      .rotate()
      .resize({
        width: PUBLISH_MAX_DIMENSION,
        height: PUBLISH_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    if (meta.hasAlpha === true) {
      // Transparency survives only as PNG — palette+deflate gets photo
      // PNGs (the pollinations shape) under the cap too.
      const out = await pipeline
        .clone()
        .png({ compressionLevel: 9, palette: true, colors: 256 })
        .toBuffer();
      return out.length <= PUBLISH_MAX_IMAGE_BYTES
        ? { buffer: out, contentType: "image/png" }
        : null;
    }
    for (const quality of [82, 68, 55]) {
      const out = await pipeline
        .clone()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (out.length <= PUBLISH_MAX_IMAGE_BYTES) {
        return { buffer: out, contentType: "image/jpeg" };
      }
    }
    return null;
  } catch {
    return null;
  }
}
