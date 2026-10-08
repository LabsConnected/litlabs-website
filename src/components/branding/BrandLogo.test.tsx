import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_WORDMARK_FRAME,
  BRAND_WORDMARK_SRC,
  brandFrameDisplaySize,
} from "@/components/branding/brand-assets";

describe("BrandLogo", () => {
  it("uses the supplied LiTTree LabStudios logo asset for the full mark", () => {
    const component = readFileSync(join(process.cwd(), "src/components/branding/BrandLogo.tsx"), "utf8");
    const assets = readFileSync(join(process.cwd(), "src/components/branding/brand-assets.ts"), "utf8");
    expect(component).toContain("BRAND_WORDMARK_SRC");
    expect(component).toContain("BRAND_WORDMARK_FRAME");
    expect(component).toContain("BRAND_MARK_SRC");
    expect(assets).toContain(BRAND_WORDMARK_SRC);
    expect(assets).toContain("/branding/littree-crystal-mark.png");
  });

  it("sizes the wordmark from its opaque content, not the padded canvas", () => {
    const box = brandFrameDisplaySize(BRAND_WORDMARK_FRAME, 42);
    const canvasAspect = BRAND_WORDMARK_FRAME.width / BRAND_WORDMARK_FRAME.height;
    const contentAspect = box.displayW / box.displayH;
    expect(contentAspect).toBeGreaterThan(canvasAspect);
    expect(box.displayH).toBe(42);
    expect(box.displayW).toBeGreaterThan(42 * 4);
  });

  it("ships the replacement logo asset", () => {
    const source = readFileSync(join(process.cwd(), "public/branding/littree-labstudios-logo.png"));
    expect(source.length).toBeGreaterThan(10_000);
  });

  it("does not point product surfaces at the retired circuit-tree or geometric L", () => {
    const files = [
      "src/components/landing/TrustSection.tsx",
      "src/components/seo/AuthorityJsonLd.tsx",
      "src/app/(app)/games/page.tsx",
      "src/lib/litt.ts",
      "public/manifest.json",
      "src/components/branding/BrandLogo.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("/logo-littree.svg");
      expect(source, file).not.toContain('"/logo.png"');
      expect(source, file).not.toContain('"/logo.webp"');
    }
  });
});
