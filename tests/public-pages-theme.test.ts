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

describe("shared public header/footer wear the light-locked design (ART-20261111-096)", () => {
  it("MarketingHeader carries no dark-theme paint", () => {
    const src = read("src/components/marketing/MarketingHeader.tsx");
    for (const stale of ["#05070d", "text-white", "border-white", "bg-white/5"]) {
      expect(src).not.toContain(stale);
    }
    // Light Signature values: muted nav text, white mobile panel, and the
    // deliberate #0b120d plate that keeps the dark-backdrop logo art legible.
    expect(src).toContain("text-[#63745f]");
    expect(src).toContain("bg-white/95");
    expect(src).toContain("bg-[#0b120d]");
  });

  it("MarketingFooter is a white surface with muted Signature text", () => {
    const src = read("src/components/marketing/MarketingFooter.tsx");
    expect(src).not.toContain("#03050a");
    expect(src).not.toContain("text-white");
    expect(src).not.toContain("border-white");
    expect(src).toContain("bg-white");
    expect(src).toContain("text-[#63745f]");
    expect(src).toContain("bg-[#0b120d]");
  });

  it("header chrome CSS paints white glass with green/lime accents", () => {
    const css = read("src/app/landing-upgrade.css");
    // The old charcoal header glass is gone (landing sections keep their
    // own dark values elsewhere in this file — only the header rule is pinned).
    expect(css).not.toContain("rgba(3, 5, 10, 0.76)");
    const headerRule = css.slice(css.indexOf(".litt-site-header {"));
    expect(headerRule).toContain("background: rgba(255, 255, 255, 0.86)");
    // Nav/footer links: muted green-grey text, deep-green hover, lime
    // underline tail (was white text + cyan tail).
    const linkRule = css.slice(
      css.indexOf(".litt-nav-link,"),
      css.indexOf(".litt-nav-link::after"),
    );
    expect(linkRule).toContain("color: #63745f");
    expect(css).toContain("linear-gradient(90deg, var(--litt-green), #8fd14f)");
    expect(css).not.toContain("linear-gradient(90deg, var(--litt-green), var(--litt-cyan))");
  });
});
