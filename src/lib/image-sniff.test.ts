import { describe, it, expect } from "vitest";
import { sniffImageMimeType } from "./image-sniff";

describe("sniffImageMimeType", () => {
  it("identifies JPEG by magic bytes", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    expect(sniffImageMimeType(jpeg)).toBe("image/jpeg");
  });

  it("identifies PNG by magic bytes", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(sniffImageMimeType(png)).toBe("image/png");
  });

  it("identifies GIF and WebP", () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageMimeType(gif)).toBe("image/gif");
    const webp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]), // RIFF<size>
      Buffer.from([0x57, 0x45, 0x42, 0x50]), // WEBP
      Buffer.alloc(8),
    ]);
    expect(sniffImageMimeType(webp)).toBe("image/webp");
  });

  it("identifies AVIF via ftyp brand", () => {
    const avif = Buffer.concat([
      Buffer.alloc(4), // size
      Buffer.from("ftypavif", "ascii"),
      Buffer.alloc(8),
    ]);
    expect(sniffImageMimeType(avif)).toBe("image/avif");
  });

  it("returns null for non-image and undersized payloads", () => {
    expect(sniffImageMimeType(Buffer.from("hello world, not an image"))).toBeNull();
    expect(sniffImageMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
  });
});
