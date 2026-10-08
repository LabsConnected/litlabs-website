import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_WORDMARK_SIZE,
  BRAND_WORDMARK_SRC,
  brandDisplayWidth,
} from "@/components/branding/brand-assets";

function pngSize(buffer: Buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("BrandLogo", () => {
  it("uses the tight crop of the #489 wordmark, in normal flow", () => {
    const component = readFileSync(join(process.cwd(), "src/components/branding/BrandLogo.tsx"), "utf8");
    const assets = readFileSync(join(process.cwd(), "src/components/branding/brand-assets.ts"), "utf8");
    expect(component).toContain("BRAND_WORDMARK_SRC");
    expect(component).toContain("BRAND_MARK_SRC");
    expect(component).not.toContain('className="absolute');
    expect(component).not.toContain("aspect-ratio");
    expect(assets).toContain(BRAND_WORDMARK_SRC);
    expect(assets).toContain("/branding/littree-labstudios-logo.png");
    expect(assets).toContain("/branding/littree-crystal-mark.png");
  });

  it("pins the marketing header lockup to explicit pixel widths", () => {
    const header = readFileSync(join(process.cwd(), "src/components/marketing/MarketingHeader.tsx"), "utf8");
    expect(header).toContain('className="w-[108px] sm:w-[152px] lg:w-[176px]"');
    expect(header).toContain("fluid");
    expect(header).not.toContain("6.75rem");
  });

  it("sizes the wordmark from the cropped artwork aspect", () => {
    const width = brandDisplayWidth(BRAND_WORDMARK_SIZE, 40);
    expect(width / 40).toBeGreaterThan(4);
    expect(width).toBeLessThan(200);
  });

  it("ships the #489 source and a tight display crop", () => {
    const source = readFileSync(join(process.cwd(), "public/branding/littree-labstudios-logo.png"));
    expect(source.length).toBeGreaterThan(10_000);
    const display = pngSize(readFileSync(join(process.cwd(), "public/branding/littree-labstudios-wordmark.png")));
    expect(display).toEqual(BRAND_WORDMARK_SIZE);
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
