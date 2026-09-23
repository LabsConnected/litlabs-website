import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("BrandLogo", () => {
  it("uses the supplied LiTTree LabStudios logo asset for the full mark", () => {
    const source = readFileSync(join(process.cwd(), "src/components/branding/BrandLogo.tsx"), "utf8");
    expect(source).toContain("/branding/littree-labstudios-logo.png");
    expect(source).toContain("variant === \"full\" ? size * 3 : size");
  });

  it("ships the replacement logo asset", () => {
    const source = readFileSync(join(process.cwd(), "public/branding/littree-labstudios-logo.png"));
    expect(source.length).toBeGreaterThan(10_000);
  });
});
