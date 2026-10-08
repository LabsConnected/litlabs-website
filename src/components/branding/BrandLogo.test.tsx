import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("BrandLogo", () => {
  it("uses the single LiTT mark for every variant (no old LiTTree assets)", () => {
    const source = readFileSync(join(process.cwd(), "src/components/branding/BrandLogo.tsx"), "utf8");
    expect(source).toContain('"/icon-192.png"');
    expect(source.toLowerCase()).not.toContain("littree");
    expect(source).toContain("LiTT home");
  });

  it("ships the LiTT mark asset as a valid PNG", () => {
    const assetPath = join(process.cwd(), "public/icon-192.png");
    expect(existsSync(assetPath)).toBe(true);
    const bytes = readFileSync(assetPath);
    expect(bytes.length).toBeGreaterThan(10_000);
    // PNG signature
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR width/height = 192x192
    expect(bytes.readUInt32BE(16)).toBe(192);
    expect(bytes.readUInt32BE(20)).toBe(192);
  });
});
