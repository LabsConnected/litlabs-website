/**
 * Public site-walk regression coverage (2026-11-16).
 *
 * These are source-level guards for the route-group move that gives the
 * public legal/about pages the standard marketing chrome, plus the new
 * real /resources and /gallery pages and the deduped /capabilities intro.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const exists = (path: string) => existsSync(join(process.cwd(), path));

describe("public pages use marketing chrome", () => {
  it("legal/about pages live in the marketing route group", () => {
    for (const page of ["about", "terms", "privacy", "cookies"]) {
      expect(exists(`src/app/(marketing)/${page}/page.tsx`)).toBe(true);
      expect(exists(`src/app/(app)/${page}/page.tsx`)).toBe(false);
    }
  });

  it("marketing layout renders the shared header and footer", () => {
    const layout = read("src/app/(marketing)/layout.tsx");
    expect(layout).toContain("<MarketingHeader />");
    expect(layout).toContain("<MarketingFooter />");
  });

  it("LayoutShell no longer treats legal/about/hire as bare or hybrid app paths", () => {
    const shell = read("src/components/LayoutShell.tsx");
    expect(shell).not.toContain('"/about"');
    expect(shell).not.toContain('"/privacy"');
    expect(shell).not.toContain('"/terms"');
    expect(shell).not.toContain('"/cookies"');
    expect(shell).not.toContain('"/hire"');
  });
});

describe("public index pages are real routes", () => {
  it("/resources renders a real index instead of redirecting to /docs", () => {
    const page = read("src/app/(marketing)/resources/page.tsx");
    expect(page).toContain('path: "/resources"');
    expect(page).toContain('href: "/docs"');
    expect(page).toContain('href: "/showcase"');
    expect(page).toContain('href: "/pricing"');
    expect(page).toContain('href: "/hire"');
    expect(page).not.toContain("redirect(");
  });

  it("/gallery renders a real page instead of redirecting to /showcase", () => {
    const page = read("src/app/(marketing)/gallery/page.tsx");
    const client = read("src/app/(marketing)/gallery/GalleryClient.tsx");
    expect(page).toContain("<GalleryClient />");
    expect(page).not.toContain("redirect(");
    expect(client).toContain('"/api/gallery?view=community"');
    expect(client).toContain("litt-public-light");
    expect(client).toContain("public-pages-tlc.css");
  });
});

describe("/capabilities heading is not duplicated", () => {
  it("page keeps its h1 and suppresses the shared grid intro", () => {
    const page = read("src/app/(marketing)/capabilities/page.tsx");
    const grid = read("src/app/HomePageClient.tsx");
    expect(page).toContain("<CapabilityGrid showIntro={false} />");
    expect(grid).toContain("showIntro = true");
    expect(grid).toContain("{showIntro ? (");
  });
});
