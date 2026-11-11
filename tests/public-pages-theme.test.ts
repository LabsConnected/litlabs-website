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

/**
 * Marketplace family theme guard (ART-20261111-046 follow-up lane).
 *
 * The /marketplace surfaces follow the theme tokens at the root, but their
 * inner utilities hard-assumed a dark backdrop, so under the default light
 * LiTT Signature theme secondary text rendered white-on-white. These
 * assertions keep the family on the #875 light palette: no white-on-light
 * utilities, no pastel *-300 badge text, and the light-legible accent
 * variants must stay wired in.
 */
describe("marketplace family wears the light-locked design", () => {
  const files = [
    "src/app/(app)/marketplace/page.tsx",
    "src/app/(app)/marketplace/loading.tsx",
    "src/app/(app)/marketplace/MarketplaceClient.tsx",
    "src/app/(app)/marketplace/[slug]/CapabilityDetailClient.tsx",
    "src/app/(app)/marketplace/_components/AgentCard.tsx",
    "src/app/(app)/marketplace/agents/[slug]/page.tsx",
    "src/app/(app)/marketplace/agents/[slug]/AgentDetailClient.tsx",
  ];

  const darkAssuming = [
    "text-white",
    "border-white",
    "bg-white/",
    "bg-white[",
    "from-white",
    "placeholder-white",
    "rgba(255,255,255",
    "text-lime-300",
    "bg-lime-400",
    "rose-300",
    "rose-400",
    "emerald-300",
    "amber-300",
    "blue-300",
  ];

  it("no marketplace file carries dark-assuming utilities", () => {
    for (const file of files) {
      const src = read(file);
      for (const stale of darkAssuming) {
        expect(src, `${file} must not contain ${stale}`).not.toContain(stale);
      }
    }
  });

  it("marketplace home no longer paints the old near-black root", () => {
    const src = read("src/app/(app)/marketplace/MarketplaceClient.tsx");
    expect(src).not.toContain("#070812");
    expect(src).toContain("text-[#0e1510]");
  });

  it("SSR header and loading state use the brand green, not lime-300", () => {
    for (const file of [
      "src/app/(app)/marketplace/page.tsx",
      "src/app/(app)/marketplace/loading.tsx",
    ]) {
      const src = read(file);
      expect(src).toContain("#177a36");
      expect(src).toContain("border-[#cfdec4]");
    }
  });

  it("category labels use the light-legible text variants", () => {
    for (const file of [
      "src/app/(app)/marketplace/MarketplaceClient.tsx",
      "src/app/(app)/marketplace/[slug]/CapabilityDetailClient.tsx",
      "src/app/(app)/marketplace/_components/AgentCard.tsx",
    ]) {
      expect(read(file)).toContain("CATEGORY_TEXT_COLORS");
    }
  });

  it("agent detail surfaces derive a light-legible accent for text", () => {
    for (const file of [
      "src/app/(app)/marketplace/agents/[slug]/page.tsx",
      "src/app/(app)/marketplace/agents/[slug]/AgentDetailClient.tsx",
    ]) {
      expect(read(file)).toContain("legibleOnLight");
    }
    const page = read("src/app/(app)/marketplace/agents/[slug]/page.tsx");
    expect(page).toContain("litt-public-light");
    expect(page).toContain("public-pages-tlc.css");
  });
});
