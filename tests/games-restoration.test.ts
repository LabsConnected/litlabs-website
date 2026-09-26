import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function fileExists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

// Games were restored once, retired from the public V1 surface, then
// re-enabled at the owner's request (2026-09-16). The implementation is
// deliberately KEPT — the "Route Files Exist" block below still guards it
// against deletion. Public exposure now: the feature flag is on, so nav
// shows the links and the /games segment layout renders (it still
// 404-guards on the flag, so flipping it back off closes the routes).
describe("Games enabled — Navigation & Feature Flags", () => {
  describe("Feature flag is enabled", () => {
    it("retroGameRuntime.enabled is true", () => {
      const content = readFileSync(join(ROOT, "src/config/feature-flags.ts"), "utf8");
      const match = content.match(/retroGameRuntime:\s*\{[\s\S]*?enabled:\s*(true|false)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("true");
    });

    it("retroGameRuntime.hideFromNav is false", () => {
      const content = readFileSync(join(ROOT, "src/config/feature-flags.ts"), "utf8");
      const match = content.match(/retroGameRuntime:\s*\{[\s\S]*?hideFromNav:\s*(true|false)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("false");
    });
  });

  describe("Navigation is gated on the flag", () => {
    // The canonical nav (lib/navigation.ts → AppShell) is the single live
    // nav source — the legacy Navbar/NavbarWrapper/Sidebar/MobileBottomNav
    // files were retired with the canonical-nav consolidation.
    it("the canonical More nav gates its Games link on retroGameRuntime", () => {
      const content = readFileSync(join(ROOT, "src/lib/navigation.ts"), "utf8");
      expect(content).toContain('isFeatureEnabled("retroGameRuntime")');
      expect(content).toMatch(/Games[\s\S]*\/games|\/games[\s\S]*Games/);
    });
  });

  describe("Routes are open, and still guard on the flag", () => {
    it("the /games segment layout 404s when the flag is off", () => {
      const content = readFileSync(
        join(ROOT, "src/app/(app)/games/layout.tsx"),
        "utf8",
      );
      expect(content).toContain('isFeatureEnabled("retroGameRuntime")');
      expect(content).toContain("notFound()");
    });

    it("/games is intentionally kept out of the sitemap for now (soft launch)", () => {
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

  describe("Dashboard quick launch (v3)", () => {
    // The v2 MissionControlDashboard was retired; the dashboard composer's
    // shortcut chips are the live creation surface.
    it("BuildConsole has a Game creation chip linked to a real surface", () => {
      const content = readFileSync(
        join(ROOT, "src/components/dashboard/v3/BuildConsole.tsx"),
        "utf8",
      );
      expect(content).toContain('"Game"');
      expect(content).toContain("Gamepad2");
      expect(content).toContain("/studio?creator=game");
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
  it("the dashboard composer renders a gamepad icon for the Game chip", () => {
    // dashboard-v2-utils (v2 Icon component) was retired with the v2
    // dashboard; lucide's Gamepad2 is the live game icon.
    const content = readFileSync(
      join(ROOT, "src/components/dashboard/v3/BuildConsole.tsx"),
      "utf8",
    );
    expect(content).toContain("Gamepad2");
  });
});
