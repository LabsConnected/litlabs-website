/**
 * fitImageForPublish — publish-safe image sizing.
 *
 * Regression coverage for golden run 42455260375: a rehosted
 * full-resolution hotlink (>2MB) wrote fine but could never be read
 * back for publish — deploy failed with "index.html →
 * assets/images/external-image-*.jpeg missing".
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { fitImageForPublish, PUBLISH_MAX_IMAGE_BYTES } from "./asset-image-fit";

/** Real oversized raster: noise does not compress, so this lands >2MB. */
async function oversizedPng(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const width = 2600;
  const height = 1700;
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function oversizedJpeg(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const width = 3200;
  const height = 2000;
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe("fitImageForPublish", () => {
  it("passes a small image through untouched", async () => {
    const sharp = (await import("sharp")).default;
    const small = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const out = await fitImageForPublish(small, "image/png");
    expect(out).not.toBeNull();
    expect(out!.buffer).toBe(small);
    expect(out!.contentType).toBe("image/png");
  });

  it("shrinks an oversized photo PNG under the publish cap as JPEG", async () => {
    const png = await oversizedPng();
    expect(png.length).toBeGreaterThan(PUBLISH_MAX_IMAGE_BYTES);
    const out = await fitImageForPublish(png, "image/png");
    expect(out).not.toBeNull();
    expect(out!.contentType).toBe("image/jpeg");
    expect(out!.buffer.length).toBeLessThanOrEqual(PUBLISH_MAX_IMAGE_BYTES);
    // Output must be a real, decodable image.
    const sharp = (await import("sharp")).default;
    const meta = await sharp(out!.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1920);
  });

  it("shrinks an oversized JPEG under the publish cap", async () => {
    const jpg = await oversizedJpeg();
    expect(jpg.length).toBeGreaterThan(PUBLISH_MAX_IMAGE_BYTES);
    const out = await fitImageForPublish(jpg, "image/jpeg");
    expect(out).not.toBeNull();
    expect(out!.buffer.length).toBeLessThanOrEqual(PUBLISH_MAX_IMAGE_BYTES);
  });

  it("refuses oversized formats it cannot safely re-encode", async () => {
    // GIF is not in the resizable set — an oversized gif must be refused
    // rather than written as an undeployable asset.
    const gif = Buffer.concat([
      Buffer.from("GIF89a", "ascii"),
      randomBytes(PUBLISH_MAX_IMAGE_BYTES + 1024),
      Buffer.from([0x3b]),
    ]);
    const out = await fitImageForPublish(gif, "image/gif");
    expect(out).toBeNull();
  });
});
