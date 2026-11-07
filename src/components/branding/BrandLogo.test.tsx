import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("BrandLogo cyber-tree identity", () => {
  const source = readFileSync(join(process.cwd(), "src/components/branding/BrandLogo.tsx"), "utf8");
  const svg = readFileSync(join(process.cwd(), "public/branding/littree-orbit-tree.svg"), "utf8");

  it("uses the new LT cyber-tree mark, never the rejected legacy graphics", () => {
    expect(source).toContain("/branding/littree-orbit-tree.svg");
    expect(source).not.toContain("/branding/littree-labstudios-logo.png");
    expect(source).not.toContain("/brand/litt-robot-96.png");
    expect(source).not.toContain("logo-littree.svg");
  });

  it("ensures full variants expose readable LiTTree LabStudios text", () => {
    expect(source).toContain('variant === "full" || showText');
    expect(source).toContain("LiT<span");
    expect(source).toContain("Tree</span>");
    expect(source).toContain("LabStudios");
    expect(source).toContain('aria-label="LiTTree LabStudios home"');
  });

  it("ships a complete independent scalable tree and LT insignia", () => {
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('id="orbit"');
    expect(svg).toContain('id="roots"');
    expect(svg).toContain('id="crest"');
    expect(svg).toContain("</svg>");
  });
});
