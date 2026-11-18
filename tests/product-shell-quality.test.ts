// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("signed-in product shell quality", () => {
  it("marks active navigation destinations for assistive technology", () => {
    const source = read("src/components/AppShell.tsx");
    // TopNavItem marks the active destination. (The second occurrence
    // this count used to require was the More menu's own toggle button;
    // the header-nav change — Larry 2026-11-16 — deleted the More menu
    // and promoted its destinations into the main nav, where each one
    // now marks itself through TopNavItem.)
    expect(source.match(/aria-current=\{active \? "page" : undefined\}/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("uses real health state in the top bar", () => {
    const source = read("src/components/AppShell.tsx");
    expect(source).not.toContain(">LiTT Online</span>");
    // One shared TopBar now owns the health indicator (was 2: desktop + mobile)
    expect(source.match(/const littHealth = useLittHealth\(\);/g)?.length).toBe(1);
  });

  it("shows the current page in the shared breadcrumb", () => {
    const source = read("src/components/PageShell.tsx");
    expect(source).toContain('aria-current="page"');
    expect(source).toContain('{title ?? "Current page"}');
  });

  it("uses the canonical project API and contains no dead /library link", () => {
    const source = read("src/app/(app)/projects/page.tsx");
    expect(source).toContain('fetch("/api/studio-projects"');
    expect(source).not.toMatch(/href:\s*"\/library"/);
    expect(source).not.toContain("LabsConnected/litlabs-website");
  });
});
