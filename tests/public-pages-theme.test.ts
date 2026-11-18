import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Public-pages theme alignment guard (ART-20261110-020).
 *
 * The approved design standard is the light-locked homepage language
 * (white worked into green, lime accents). These source-level assertions
 * keep the re-dressed public pages from silently regressing to the old
 * dark theme: electric cyan/violet/orange palette on pricing, and the
 * near-black #03050a page backgrounds on the Tailwind-chromed pages.
 */
const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("public pages wear the light-locked design", () => {
  it("pricing module is light-locked with no old dark palette values", () => {
    const css = read("src/app/(marketing)/pricing/pricing.module.css");
    expect(css).toContain("color-scheme: light");
    for (const stale of ["#07070b", "#30e7ff", "#9a63ff", "#ff7a1a", "#c5b8ff", "#7a4ee8"]) {
      expect(css.toLowerCase()).not.toContain(stale);
    }
  });

  it("legal pages opt into the .litt-legal light scope", () => {
    for (const page of ["privacy", "cookies"]) {
      const src = read(`src/app/(app)/${page}/page.tsx`);
      expect(src).toContain("litt-legal");
      expect(src).toContain("public-pages-tlc.css");
    }
    const css = read("src/app/public-pages-tlc.css");
    expect(css).toContain(".litt-legal");
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("--bg-color: #ffffff");
    expect(css).toContain("--header-color: #0c5a26");
  });

  it("Tailwind-chromed public pages no longer paint the old near-black background", () => {
    const pages = [
      "src/app/(app)/terms/page.tsx",
      "src/app/(app)/about/page.tsx",
      "src/app/(marketing)/agents/AgentsCatalog.tsx",
      "src/app/(marketing)/capabilities/page.tsx",
      "src/app/(marketing)/cli/CliPageClient.tsx",
    ];
    for (const page of pages) {
      expect(read(page)).not.toContain("bg-[#03050a]");
    }
  });

  it("hire and showcase public pages wear the light-locked scope", () => {
    const pages = [
      "src/app/(app)/hire/HireClient.tsx",
      "src/app/(app)/showcase/[slug]/page.tsx",
      "src/app/(app)/showcase/PublicShowcaseGallery.tsx",
    ];
    for (const page of pages) {
      const src = read(page);
      expect(src).toContain("litt-public-light");
      expect(src).toContain("public-pages-tlc.css");
      expect(src).not.toContain("bg-[#03050a]");
      expect(src).not.toContain("bg-[#0a0d14]");
      expect(src).not.toContain("text-white");
    }
  });

  it("showcase demo accents are legible on the light theme", () => {
    const src = read("src/app/(app)/showcase/projects.ts").toLowerCase();
    for (const neon of ["#b58cff", "#65f4ff", "#a8ff2f"]) {
      expect(src).not.toContain(neon);
    }
    const gallery = read("src/app/(app)/showcase/PublicShowcaseGallery.tsx");
    expect(gallery).not.toContain("#65f4ff");
  });

  it("docs code panels use the brand deep-green, not the old blue-black", () => {
    const src = read("src/app/(app)/docs/_components/DocPrimitives.tsx");
    expect(src).not.toContain("#05070d");
    expect(src).toContain("#0b120d");
  });
});
