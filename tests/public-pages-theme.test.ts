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
});
