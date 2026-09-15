import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function fileExists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

// Games were restored once, then retired from the public V1 surface. The
// implementation is deliberately KEPT — the "Route Files Exist" block below
// still guards it against deletion, so it can come back. What changed is the
// public exposure: the feature flag is off, so nav hides the links and the
// /games segment layout returns 404.
describe("Games retired from public V1 — Navigation & Feature Flags", () => {
  describe("Feature flag is disabled", () => {
    it("retroGameRuntime.enabled is false", () => {
      const content = readFileSync(join(ROOT, "src/config/feature-flags.ts"), "utf8");
      const match = content.match(/retroGameRuntime:\s*\{[\s\S]*?enabled:\s*(true|false)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("false");
    });

    it("retroGameRuntime.hideFromNav is true", () => {
      const content = readFileSync(join(ROOT, "src/config/feature-flags.ts"), "utf8");
      const match = content.match(/retroGameRuntime:\s*\{[\s\S]*?hideFromNav:\s*(true|false)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("true");
    });
  });

  describe("Navigation is gated on the flag", () => {
    it("Navbar gates its Games link on retroGameRuntime", () => {
      const content = readFileSync(join(ROOT, "src/components/Navbar.tsx"), "utf8");
      expect(content).toContain('isFeatureEnabled("retroGameRuntime")');
    });

    it("NavbarWrapper gates its Games link on retroGameRuntime", () => {
      const content = readFileSync(join(ROOT, "src/components/NavbarWrapper.tsx"), "utf8");
      expect(content).toContain('isFeatureEnabled("retroGameRuntime")');
    });
  });

  describe("Routes are closed, not just unlinked", () => {
    it("the /games segment layout 404s when the flag is off", () => {
      const content = readFileSync(
        join(ROOT, "src/app/(app)/games/layout.tsx"),
        "utf8",
      );
      expect(content).toContain('isFeatureEnabled("retroGameRuntime")');
      expect(content).toContain("notFound()");
    });

    it("/games is absent from the sitemap", () => {
      const content = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");
      expect(content).not.toContain('absoluteUrl("/games")');
    });

    it("the /games layout is not SEO-indexed", () => {
      const content = readFileSync(
        join(ROOT, "src/app/(app)/games/layout.tsx"),
        "utf8",
      );
      expect(content).toMatch(/index:\s*false/);
    });
  });

  describe("Mission Control dashboard quick launch", () => {
    it("MissionControlDashboard has the four primary actions", () => {
      const content = readFileSync(
        join(ROOT, "src/components/dashboard/v2/MissionControlDashboard.tsx"),
        "utf8",
      );
      expect(content).toContain("Ask LiTT");
      expect(content).toContain(">Build<");
      expect(content).toContain(">Create<");
      expect(content).toContain(">Deploy<");
    });
  });
});

describe("Games Restoration — Route Files Exist", () => {
  const routes = [
    "src/app/(app)/games/page.tsx",
    "src/app/(app)/games/layout.tsx",
    "src/app/(app)/games/retro/page.tsx",
    "src/app/(app)/games/retro/layout.tsx",
    "src/app/(app)/games/retro/play/[gameId]/page.tsx",
    "src/app/(app)/games/retro/play/[gameId]/layout.tsx",
    "src/app/(app)/games/dos/page.tsx",
    "src/app/(app)/games/dos/layout.tsx",
    "src/app/(app)/games/cloud/page.tsx",
    "src/app/(app)/games/cloud/layout.tsx",
  ];

  for (const route of routes) {
    it(`${route} exists`, () => {
      expect(fileExists(route)).toBe(true);
    });
  }

  it("game library exists", () => {
    expect(fileExists("src/lib/games.ts")).toBe(true);
  });

  it("retro arcade library exists", () => {
    expect(fileExists("src/lib/retro-arcade.ts")).toBe(true);
  });

  it("game components directory has content", () => {
    expect(fileExists("src/components/games/GameCard.tsx")).toBe(true);
    expect(fileExists("src/components/games/GameCloudHome.tsx")).toBe(true);
    expect(fileExists("src/components/games/RetroArcadeEmbedded.tsx")).toBe(true);
  });
});

describe("Games Restoration — Icon Support", () => {
  it("Mission Control Icon component supports 'gamepad'", () => {
    const content = readFileSync(
      join(ROOT, "src/components/dashboard/v2/dashboard-v2-utils.tsx"),
      "utf8",
    );
    expect(content).toContain("gamepad:");
  });
});
