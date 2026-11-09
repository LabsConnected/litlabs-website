/**
 * Image MIME sniffing from magic bytes.
 *
 * Provider APIs frequently return image bytes without a trustworthy type
 * label — Cloudflare Workers AI's flux-1-schnell returns JPEG bytes inside
 * a JSON envelope, and several handlers historically hardcoded
 * `data:image/png` regardless of the actual encoding. A wrong label is not
 * cosmetic: insertAssetFromUrl validates structure against the DECLARED
 * type, so JPEG bytes labeled image/png fail the PNG head/tail check as
 * "truncated or corrupt" and the auto-insert reports savedToProject:false
 * (the 2026-11-08 staging approval loop: every approved image.generate
 * generated successfully but could never be saved, so the model retried
 * image.generate under a fresh approval each time).
 *
 * The bytes are ground truth — callers should prefer this over any
 * declared content-type when the sniff identifies a concrete format.
 */

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8
const FTYP_TAG = [0x66, 0x74, 0x79, 0x70]; // "ftyp" at offset 4

function startsWith(buf: Buffer, magic: number[], offset = 0): boolean {
  if (buf.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[offset + i] !== magic[i]) return false;
  }
  return true;
}

function asciiAt(buf: Buffer, offset: number, length: number): string {
  return buf.toString("ascii", offset, offset + length);
}

/**
 * Returns the concrete image MIME type the buffer's magic bytes identify,
 * or null when the payload does not match a known raster format. Null
 * means "unknown" — callers keep their declared type rather than guess.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (startsWith(buffer, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(buffer, PNG_MAGIC)) return "image/png";
  if (startsWith(buffer, GIF_MAGIC)) return "image/gif";
  if (startsWith(buffer, RIFF_MAGIC) && startsWith(buffer, WEBP_TAG, 8)) {
    return "image/webp";
  }
  // ISO-BMFF containers (AVIF/HEIC): "....ftyp<brand>" — only claim AVIF
  // when the major or a compatible brand says so.
  if (startsWith(buffer, FTYP_TAG, 4)) {
    const brands = asciiAt(buffer, 8, Math.min(buffer.length - 8, 32));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  return null;
}
