import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Launch-polish regression tests for the shared public chrome.
 *
 * These assert the invariants found in first-time-user QA:
 *   1. No visitor-visible internal production notes / coming-soon copy.
 *   2. /pricing (via the (marketing) layout), /marketplace (signed-out),
 *      and /sign-in render the shared marketing header so visitors have an
 *      obvious path home.
 *   3. Copyright year comes from one shared source of truth.
 *   4. The "Not a chat. A working system." headline is not duplicated.
 *   5. The public footer does not advertise auth-gated /gallery or /showcase.
 *   6. Footer GitHub links point at the LabsConnected org, never a generic
 *      github.com landing page.
 */

const readSrc = (rel: string) =>
  readFileSync(path.resolve(__dirname, "..", rel), "utf-8");

describe("public site chrome", () => {
  it("(marketing) layout renders the shared header/footer", () => {
    const src = readSrc("src/app/(marketing)/layout.tsx");
    expect(src).toContain('from "@/components/marketing/MarketingHeader"');
    expect(src).toContain('from "@/components/marketing/MarketingFooter"');
    expect(src).toContain("<MarketingHeader />");
    expect(src).toContain("<MarketingFooter />");
  });

  it("homepage has no duplicated local chrome implementation", () => {
    const src = readSrc("src/app/HomePageClient.tsx");
    // Chrome comes from the (marketing) layout — no local copies.
    expect(src).not.toContain("function Header(");
    expect(src).not.toContain("function Footer(");
    expect(src).not.toContain("litt-site-header");
  });

  it("LayoutShell renders public chrome on signed-out /marketplace", () => {
    const src = readSrc("src/components/LayoutShell.tsx");
    expect(src).toContain("MarketingHeader");
    expect(src).toContain("MarketingFooter");
    expect(src).toContain('"/marketplace"');
  });

  it("sign-in layout renders the shared header and footer", () => {
    const src = readSrc("src/app/sign-in/layout.tsx");
    expect(src).toContain("MarketingHeader");
    expect(src).toContain("MarketingFooter");
  });
});

describe("real product proof section", () => {
  const src = readSrc("src/components/landing/RealProductProof.tsx");

  it("contains no placeholder or internal production copy", () => {
    expect(src).not.toMatch(/coming soon/i);
    expect(src).not.toContain("Required asset");
    expect(src).not.toContain("HAS_REAL_VIDEO");
    expect(src).not.toContain("litt-video-placeholder");
    expect(src).not.toContain("litt-real-session");
    expect(src).not.toMatch(/placeholder/i);
  });

  it("still renders the session pipeline content", () => {
    expect(src).toContain("Session pipeline");
    expect(src).toContain("Approval ready");
    expect(src).toContain('id="real-proof"');
  });
});

describe("duplicate headline", () => {
  it("'Not a chat. A working system.' is defined in exactly one section", () => {
    const sources = [
      readSrc("src/app/HomePageClient.tsx"),
      readSrc("src/components/landing/ComparisonTable.tsx"),
      readSrc("src/components/landing/RealProductProof.tsx"),
      readSrc("src/components/landing/TrustSection.tsx"),
      readSrc("src/components/landing/OnboardingSteps.tsx"),
      readSrc("src/components/landing/FAQSection.tsx"),
      readSrc("src/components/landing/AgentCrew.tsx"),
      readSrc("src/components/landing/RealCreations.tsx"),
      readSrc("src/components/landing/CapabilityStatus.tsx"),
      readSrc("src/components/landing/LandingHeroV3.tsx"),
      readSrc("src/components/landing/InteractiveProductDemo.tsx"),
      readSrc("src/components/landing/WhyDifferent.tsx"),
      readSrc("src/components/landing/MissionSequence.tsx"),
      readSrc("src/components/marketing/MarketingHeader.tsx"),
      readSrc("src/components/marketing/MarketingFooter.tsx"),
    ];
    const occurrences = sources.reduce(
      (count, s) => count + (s.match(/Not a chat\./g) ?? []).length,
      0,
    );
    expect(occurrences).toBe(1);
    // The surviving placement is the comparison section heading.
    const comparison = readSrc("src/components/landing/ComparisonTable.tsx");
    expect(comparison).toContain("Not a chat.");
    expect(comparison).toContain("A working system.");
  });
});

describe("footer consolidation", () => {
  it("marketing footer link set excludes auth-gated destinations", () => {
    const src = readSrc("src/components/marketing/MarketingFooter.tsx");
    // /gallery redirects to /showcase which requires sign-in.
    expect(src).not.toContain('"/gallery"');
    expect(src).not.toContain('"/showcase"');
    expect(src).not.toContain('href="/gallery"');
    expect(src).not.toContain('href="/showcase"');
  });

  it("marketing footer carries the shared copyright line", () => {
    const src = readSrc("src/components/marketing/MarketingFooter.tsx");
    expect(src).toContain("SITE_COPYRIGHT_YEAR");
    expect(src).not.toMatch(/©\s*20\d\d/);
  });

  it("app footer GitHub link targets the LabsConnected org", () => {
    const footer = readSrc("src/components/Footer.tsx");
    const config = readSrc("src/lib/siteConfig.ts");
    expect(footer).toContain("SITE_GITHUB_URL");
    expect(config).toContain("https://github.com/LabsConnected");
    // No generic github.com landing link anywhere in the footer.
    expect(footer).not.toContain('"https://github.com"');
    expect(footer).not.toMatch(/©\s*20\d\d/);
  });

  it("agents page footer uses the shared copyright year", () => {
    const src = readSrc("src/app/(app)/agents/AgentsPageClient.tsx");
    expect(src).toContain("SITE_COPYRIGHT_YEAR");
    expect(src).not.toContain("new Date().getFullYear()");
  });
});
